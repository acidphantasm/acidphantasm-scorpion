import { DependencyContainer, container } from "tsyringe";

// SPT types
import { IPreAkiLoadMod } from "@spt-aki/models/external/IPreAkiLoadMod";
import { IPostDBLoadMod } from "@spt-aki/models/external/IPostDBLoadMod";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { PreAkiModLoader } from "@spt-aki/loaders/PreAkiModLoader";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { ImageRouter } from "@spt-aki/routers/ImageRouter";
import { ConfigServer } from "@spt-aki/servers/ConfigServer";
import { ConfigTypes } from "@spt-aki/models/enums/ConfigTypes";
import { ITraderConfig } from "@spt-aki/models/spt/config/ITraderConfig";
import { IRagfairConfig } from "@spt-aki/models/spt/config/IRagfairConfig";
import type {DynamicRouterModService} from "@spt-aki/services/mod/dynamicRouter/DynamicRouterModService";
import { JsonUtil } from "@spt-aki/utils/JsonUtil";
import { RandomUtil } from "@spt-aki/utils/RandomUtil";
import * as fs from "node:fs";
import * as path from "node:path";

// New trader settings\
import { TraderHelper } from "./traderHelpers";
import { FluentAssortConstructor as FluentAssortCreator } from "./fluentTraderAssortCreator";
import { Traders } from "@spt-aki/models/enums/Traders";
import { HashUtil } from "@spt-aki/utils/HashUtil";
import * as baseJson            from "../db/base.json";
import * as questAssort         from "../db/questassort.json";

let realismDetected: boolean;

class Scorpion implements IPreAkiLoadMod, IPostDBLoadMod
{
    private mod: string
    private logger: ILogger
    private traderHelper: TraderHelper
    private fluentAssortCreator: FluentAssortCreator
    private static config: Config;
    private static configPath = path.resolve(__dirname, "../config/config.json");
    private static assortPath = path.resolve(__dirname, "../db/assort.json");

    constructor() 
    {
        this.mod = "acidphantasm-scorpion"; // Set name of mod so we can log it to console later
    }
    /**
     * Some work needs to be done prior to SPT code being loaded, registering the profile image + setting trader update time inside the trader config json
     * @param container Dependency container
     */
    public preAkiLoad(container: DependencyContainer): void
    {
        // Get a logger
        this.logger = container.resolve<ILogger>("WinstonLogger");

        // Get SPT code/data we need later
        const preAkiModLoader: PreAkiModLoader = container.resolve<PreAkiModLoader>("PreAkiModLoader");
        const imageRouter: ImageRouter = container.resolve<ImageRouter>("ImageRouter");
        const databaseServer: DatabaseServer = container.resolve<DatabaseServer>("DatabaseServer");
        const hashUtil: HashUtil = container.resolve<HashUtil>("HashUtil");
        const configServer = container.resolve<ConfigServer>("ConfigServer");
        const traderConfig: ITraderConfig = configServer.getConfig<ITraderConfig>(ConfigTypes.TRADER);
        const ragfairConfig = configServer.getConfig<IRagfairConfig>(ConfigTypes.RAGFAIR);
        const dynamicRouterModService = container.resolve<DynamicRouterModService>("DynamicRouterModService");
        
        //Load config file before accessing it
        Scorpion.config = JSON.parse(fs.readFileSync(Scorpion.configPath, "utf-8"));

        // Set config values to local variables for validation & use
        let minRefresh = Scorpion.config.traderRefreshMin;
        let maxRefresh = Scorpion.config.traderRefreshMax;
        const addToFlea = Scorpion.config.addTraderToFlea;
        if (minRefresh >= maxRefresh)
        {
            minRefresh = 1800;
            maxRefresh = 3600;
            this.logger.error(`[${this.mod}] [Config Issue]  traderRefreshMin must be less than traderRefreshMax. Refresh timers have been reset to default.`);
        }
        if (maxRefresh <= 2)
        {
            minRefresh = 1800;
            maxRefresh = 3600;
            this.logger.error(`[${this.mod}] [Config Issue]  You set traderRefreshMax too low. Refresh timers have been reset to default.`);
        }

        // Create helper class and use it to register our traders image/icon + set its stock refresh time
        this.traderHelper = new TraderHelper();
        this.fluentAssortCreator = new FluentAssortCreator(hashUtil, this.logger);
        this.traderHelper.registerProfileImage(baseJson, this.mod, preAkiModLoader, imageRouter, "scorpion.jpg");
        this.traderHelper.setTraderUpdateTime(traderConfig, baseJson, minRefresh, maxRefresh);

        // Add trader to trader enum
        Traders[baseJson._id] = baseJson._id;

        // Add trader to flea market
        if (addToFlea)
        {
            ragfairConfig.traders[baseJson._id] = true;
        }
        else
        {
            ragfairConfig.traders[baseJson._id] = false;
        }

        dynamicRouterModService.registerDynamicRouter(
            "ScorpionRefreshStock",
            [
                {
                    url: "/client/items/prices/Scorpion",
                    action: (url, info, sessionId, output) => 
                    {
                        const trader = databaseServer.getTables().traders["Scorpion"];
                        const assortItems = trader.assort.items;
                        if (!realismDetected)
                        {
                            if (Scorpion.config.randomizeBuyRestriction)
                            {
                                if (Scorpion.config.debugLogging) {this.logger.info(`[${this.mod}] Refreshing Scorpion Stock with Randomized Buy Restrictions.`);}
                                this.randomizeBuyRestriction(assortItems);
                            }
                            if (Scorpion.config.randomizeStockAvailable)
                            {
                                if (Scorpion.config.debugLogging) {this.logger.info(`[${this.mod}] Refreshing Scorpion Stock with Randomized Stock Availability.`);}
                                this.randomizeStockAvailable(assortItems);
                            }
                        }
                        return output;
                    }
                }
            ],
            "aki"
        );
    }
        
    /**
     * Majority of trader-related work occurs after the aki database has been loaded but prior to SPT code being run
     * @param container Dependency container
     */
    public postDBLoad(container: DependencyContainer): void
    {
        const start = performance.now();

        // Resolve SPT classes we'll use
        const preAkiModLoader: PreAkiModLoader = container.resolve<PreAkiModLoader>("PreAkiModLoader");
        const logger = container.resolve<ILogger>("WinstonLogger");
        const databaseServer: DatabaseServer = container.resolve<DatabaseServer>("DatabaseServer");
        const jsonUtil: JsonUtil = container.resolve<JsonUtil>("JsonUtil");

        //Get & Set Assort Information
        const assortJson = JSON.parse(fs.readFileSync(Scorpion.assortPath, "utf-8"));
        const assortPriceTable = assortJson["barter_scheme"];
        const assortItemTable = assortJson["items"];

        //Mod Detection
        const vcqlCheck = preAkiModLoader.getImportedModsNames().includes("Virtual's Custom Quest Loader");
        const realismCheck = preAkiModLoader.getImportedModsNames().includes("SPT-Realism");
        const vcqlDllPath = path.resolve(__dirname, "../../../../BepInEx/plugins/VCQLQuestZones.dll");
        if (!fs.existsSync(vcqlDllPath)) {
            this.logger.error(`[${this.mod}] [ERROR] VCQL Zones DLL missing. For Zones to work, install [VCQL].`);
        }
        if (!vcqlCheck)
        {
            this.logger.error(`[${this.mod}] [ERROR] VCQL missing. For Quests to work, install [VCQL] and then reinstall [${this.mod}].`);
        }
        if (Scorpion.config.randomizeBuyRestriction || Scorpion.config.randomizeStockAvailable)
        {
            this.setRealismDetection(realismCheck);
        }
        else
        {
            this.setRealismDetection(realismCheck);
        }

        //Update Assort Pricing via config multiplier for server
        if (Scorpion.config.priceMultiplier != 1)
        {
            this.setPriceMultiplier(assortPriceTable);
        }
        if (!realismDetected && Scorpion.config.randomizeBuyRestriction)
        {
            this.randomizeBuyRestriction(assortItemTable);
        }
        if (!realismDetected && Scorpion.config.randomizeStockAvailable)
        {
            this.randomizeStockAvailable(assortItemTable);
        }

        // Set local variable for assort to pass to traderHelper regardless of priceMultiplier config
        const newAssort = assortJson

        // Get a reference to the database tables
        const tables = databaseServer.getTables();

        // Add new trader to the trader dictionary in DatabaseServer       
        // Add quest assort
        // Add trader to locale file, ensures trader text shows properly on screen
        this.traderHelper.addTraderToDb(baseJson, tables, jsonUtil, newAssort);
        tables.traders[baseJson._id].questassort = questAssort;
        this.traderHelper.addTraderToLocales(baseJson, tables, baseJson.name, "Scorpion", baseJson.nickname, baseJson.location, "I'm sellin', what are you buyin'?");

        this.logger.debug(`[${this.mod}] loaded... `);

        const timeTaken = performance.now() - start;
        if (Scorpion.config.debugLogging) {logger.log(`[${this.mod}] Trader load took ${timeTaken.toFixed(3)}ms.`, "green");}
    }
    private setRealismDetection(i: boolean)
    {
        realismDetected = i;
        if (realismDetected)
        {
            this.logger.log(`[${this.mod}] SPT-Realism detected, disabling randomizeBuyRestriction and/or randomizeStockAvailable:`, "yellow");
        }
    }
    private setPriceMultiplier (assortPriceTable)
    {
        for (const itemID in assortPriceTable)
        {
            assortPriceTable[itemID].forEach(item => 
            {
                const count = item[0].count;
                const newPrice = Math.round(count * Scorpion.config.priceMultiplier);
                item[0].count = newPrice
                if (Scorpion.config.debugLogging) {this.logger.log(`[${this.mod}] itemID: [${itemID}] Price Changed to: [${newPrice}]`, "cyan");}
            })
        } 
    }
    private randomizeBuyRestriction(assortItemTable)
    {
        const randomUtil: RandomUtil = container.resolve<RandomUtil>("RandomUtil");
        // Randomize Assort Availability via config bool for server start
        for (const item in assortItemTable)
        {
            if (assortItemTable[item].upd?.BuyRestrictionMax == undefined)
            {
                continue // Skip setting count, it's a weapon attachment or armour plate
            }
            else
            {
                const itemID = assortItemTable[item]._id;
                const oldRestriction = assortItemTable[item].upd.BuyRestrictionMax;
                const newRestriction = Math.round(randomUtil.randInt((oldRestriction * 0.5), (oldRestriction)));
                
                assortItemTable[item].upd.BuyRestrictionMax = newRestriction;

                if (Scorpion.config.debugLogging) {this.logger.log(`[${this.mod}] Item: [${itemID}] Buy Restriction Changed to: [${newRestriction}]`, "cyan");}
            }
        }
    }
    private randomizeStockAvailable(assortItemTable)
    {
        const randomUtil: RandomUtil = container.resolve<RandomUtil>("RandomUtil");
        for (const item in assortItemTable)
        {
            if (assortItemTable[item].upd?.StackObjectsCount == undefined)
            {
                continue // Skip setting count, it's a weapon attachment or armour plate
            }
            else
            {
                const outOfStockRoll = randomUtil.getChance100(Scorpion.config.outOfStockChance);
                
                if (outOfStockRoll)
                {
                    const itemID = assortItemTable[item]._id;
                    assortItemTable[item].upd.StackObjectsCount = 0;

                    if (Scorpion.config.debugLogging) {this.logger.log(`[${this.mod}] Item: [${itemID}] Marked out of stock`, "cyan");}
                } 
                else
                {
                    const itemID = assortItemTable[item]._id;
                    const originalStock = assortItemTable[item].upd.StackObjectsCount;
                    const newStock = randomUtil.randInt(2, (originalStock*0.5));
                    assortItemTable[item].upd.StackObjectsCount = newStock;

                    if (Scorpion.config.debugLogging) {this.logger.log(`[${this.mod}] Item: [${itemID}] Stock Count changed to: [${newStock}]`, "cyan");}
                }

                
            }
        }
    }
}

interface Config 
{
    randomizeStockAvailable: boolean,
    outOfStockChance: number,
    randomizeBuyRestriction: boolean,
    priceMultiplier: number,
    traderRefreshMin: number,
    traderRefreshMax: number,
    addTraderToFlea: boolean,
    debugLogging: boolean,
}

module.exports = { mod: new Scorpion() }