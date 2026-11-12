export declare const PRIVATE_OWNER: { userId: string; handle: string; creatorId: string; session: string };
export declare function privateFixtureId(id: string): string;
export declare function privateRevisionId(id: string): string;
export declare function sessionHash(token: string): string;
export declare function sharedFixtureToken(id: string): string;
