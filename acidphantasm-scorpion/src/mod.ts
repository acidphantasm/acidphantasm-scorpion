import { DependencyContainer } from "tsyringe";

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
import { JsonUtil } from "@spt-aki/utils/JsonUtil";
import * as fs from "node:fs";
import * as path from "node:path";

// New trader settings\
import { TraderHelper } from "./traderHelpers";
import { FluentAssortConstructor as FluentAssortCreator } from "./fluentTraderAssortCreator";
import { Traders } from "@spt-aki/models/enums/Traders";
import { HashUtil } from "@spt-aki/utils/HashUtil";
import * as baseJson            from "../db/base.json";
import * as questAssort         from "../db/questassort.json";

class Scorpion implements IPreAkiLoadMod, IPostDBLoadMod
{
    private mod: string
    private logger: ILogger
    private traderHelper: TraderHelper
    private fluentAssortCreator: FluentAssortCreator
    private static config: Config;
    private static configPath = path.resolve(__dirname, "../config/config.json");

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
        const hashUtil: HashUtil = container.resolve<HashUtil>("HashUtil");
        const configServer = container.resolve<ConfigServer>("ConfigServer");
        const traderConfig: ITraderConfig = configServer.getConfig<ITraderConfig>(ConfigTypes.TRADER);
        const ragfairConfig = configServer.getConfig<IRagfairConfig>(ConfigTypes.RAGFAIR);
        
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
            this.logger.log(`[${this.mod}] [Config]  traderRefreshMin must be less than traderRefreshMax. Refresh timers have been reset to default.`, "red");
        }
        if (maxRefresh <= 2)
        {
            minRefresh = 1800;
            maxRefresh = 3600;
            this.logger.log(`[${this.mod}] [Config]  You set traderRefreshMax too low. Refresh timers have been reset to default.`, "red");
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
    }
    
    /**
     * Majority of trader-related work occurs after the aki database has been loaded but prior to SPT code being run
     * @param container Dependency container
     */
    public postDBLoad(container: DependencyContainer): void
    {
        const start = performance.now();

        // Resolve SPT classes we'll use
        const logger = container.resolve<ILogger>("WinstonLogger");
        const databaseServer: DatabaseServer = container.resolve<DatabaseServer>("DatabaseServer");
        const jsonUtil: JsonUtil = container.resolve<JsonUtil>("JsonUtil");

        // Get a reference to the database tables
        const tables = databaseServer.getTables();

        // Add new trader to the trader dictionary in DatabaseServer       
        // Add quest assort
        // Add trader to locale file, ensures trader text shows properly on screen
        this.traderHelper.addTraderToDb(baseJson, tables, jsonUtil);
        tables.traders[baseJson._id].questassort = questAssort;
        this.traderHelper.addTraderToLocales(baseJson, tables, baseJson.name, "Scorpion", baseJson.nickname, baseJson.location, "I'm sellin', what are you buyin'?");
        


        this.logger.debug(`[${this.mod}] loaded... `);

        const timeTaken = performance.now() - start;
        logger.log(`[${this.mod}] Trader load took ${timeTaken.toFixed(3)}ms.`, "green");
    }
}

interface Config 
{
    traderRefreshMin: number,
    traderRefreshMax: number,
    addTraderToFlea: boolean,
}

module.exports = { mod: new Scorpion() }