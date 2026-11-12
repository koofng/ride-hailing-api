import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'responseMessage';

/** A fixed message, or one chosen from the handler's result. */
export type MessageSource = string | ((data: any) => string);

/** Sets the `message` the response envelope carries when this endpoint succeeds. */
export const ResponseMessage = (message: MessageSource) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
