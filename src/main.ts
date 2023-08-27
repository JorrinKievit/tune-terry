import { LogLevel, SapphireClient } from "@sapphire/framework";
import { GatewayIntentBits, Partials } from "discord.js";
import dotenv from "dotenv";

dotenv.config();

const client = new SapphireClient({
  defaultPrefix: "!tt",
  caseInsensitiveCommands: true,
  logger: {
    level: LogLevel.Debug,
  },
  shards: "auto",
  intents: [
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel],
  loadMessageCommandListeners: true,
});

const main = async (): Promise<void> => {
  try {
    client.logger.info("Logging in...");
    await client.login(process.env.DISCORD_TOKEN);
    client.logger.info("Logged in!");
  } catch (error) {
    client.logger.fatal(error);
    client.destroy();
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  }
};

main();
