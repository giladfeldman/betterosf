declare module "sns-validator" {
  export default class MessageValidator {
    validate(
      message: Record<string, unknown>,
      callback: (err: Error | null, message?: Record<string, unknown>) => void,
    ): void;
  }
}
