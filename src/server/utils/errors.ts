export class AppError extends Error {
  public readonly code: string;
  public readonly action?: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400, action?: string) {
    super(message);
    this.code = code;
    this.action = action;
    this.statusCode = statusCode;
  }
}

interface ErrorLike {
  name?: string;
  message?: string;
  code?: string;
  type?: string;
  status?: number;
  statusCode?: number;
  field?: string;
}

const asErrorLike = (value: unknown): ErrorLike | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  return value as ErrorLike;
};

const readHttpStatus = (error: ErrorLike | undefined): number | undefined => {
  const candidate = error?.statusCode ?? error?.status;
  return Number.isFinite(candidate) ? Number(candidate) : undefined;
};

const toMulterAppError = (error: ErrorLike): AppError | undefined => {
  const isMulter = error.name === 'MulterError';
  if (!isMulter) {
    return undefined;
  }

  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return new AppError(
        'IPA_FILE_TOO_LARGE',
        'IPA upload exceeds the 600 MB limit.',
        413,
        'Choose a smaller IPA file (<= 600 MB) and retry.'
      );
    case 'LIMIT_UNEXPECTED_FILE': {
      const field = typeof error.field === 'string' && error.field.trim() ? error.field.trim() : 'unknown';
      return new AppError(
        'IPA_UPLOAD_FIELD_INVALID',
        `Unexpected upload field \`${field}\`.`,
        400,
        'Attach the IPA file using multipart field name `ipa`.'
      );
    }
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_PART_COUNT':
    case 'LIMIT_FIELD_COUNT':
    case 'LIMIT_FIELD_KEY':
    case 'LIMIT_FIELD_VALUE':
      return new AppError(
        'IPA_UPLOAD_INVALID',
        'Upload payload is invalid.',
        400,
        'Retry upload with a single IPA file field named `ipa`.'
      );
    default:
      return new AppError(
        'IPA_UPLOAD_FAILED',
        error.message || 'Failed to process IPA upload.',
        400,
        'Retry the upload and confirm payload format.'
      );
  }
};

const toBodyParserAppError = (error: ErrorLike): AppError | undefined => {
  if (error.type === 'entity.parse.failed') {
    return new AppError('REQUEST_BODY_INVALID', 'Malformed JSON request body.', 400, 'Fix JSON syntax and retry.');
  }

  if (error.type === 'entity.too.large') {
    return new AppError(
      'REQUEST_BODY_TOO_LARGE',
      'Request payload exceeds the 5 MB limit.',
      413,
      'Reduce payload size and retry.'
    );
  }

  return undefined;
};

export const toAppError = (error: unknown, fallbackCode = 'UNKNOWN_ERROR'): AppError => {
  if (error instanceof AppError) {
    return error;
  }

  const errorLike = asErrorLike(error);

  if (errorLike) {
    const multerMapped = toMulterAppError(errorLike);
    if (multerMapped) {
      return multerMapped;
    }

    const bodyMapped = toBodyParserAppError(errorLike);
    if (bodyMapped) {
      return bodyMapped;
    }

    const status = readHttpStatus(errorLike);
    if (status && status >= 400 && status < 500) {
      const code = fallbackCode === 'UNKNOWN_ERROR' ? 'REQUEST_INVALID' : fallbackCode;
      return new AppError(code, errorLike.message || 'Request rejected.', status);
    }
  }

  if (error instanceof Error) {
    return new AppError(fallbackCode, error.message, 500, 'Open the logs panel and inspect latest stack trace details.');
  }

  return new AppError(fallbackCode, 'Unexpected error', 500, 'Retry the action. If it repeats, restart demo server.');
};
