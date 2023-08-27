declare global {
  namespace NodeJS {
    // eslint-disable-next-line unicorn/prevent-abbreviations
    interface ProcessEnv {
      DISCORD_TOKEN: string;
    }
  }
}

export {};
