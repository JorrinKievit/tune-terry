export const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack?.slice(0, 100) ?? error.message;
  }
  return String(error).slice(0, 100);
};
