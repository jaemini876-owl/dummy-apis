export class ConflictError extends Error {}
export class NotFoundError extends Error {}
/** DB 마이그레이션이 적용되지 않아 기능을 쓸 수 없는 경우 (예: presets 테이블 없음) */
export class MigrationRequiredError extends Error {}
