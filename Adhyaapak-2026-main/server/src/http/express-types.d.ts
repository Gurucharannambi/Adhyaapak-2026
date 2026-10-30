import type { Role } from "@adhyaapak/shared";

declare global {
  namespace Express {
    /** The signed-in user, set by the session middleware. */
    interface AuthUser {
      id: string;
      name: string;
      email: string;
      role: Role;
    }
    /** A student who joined a classroom activity with a join code and roster number. */
    interface JoinedStudent {
      studentId: string;
      classId: string;
      name: string;
      sessionId: string;
    }
    interface Request {
      user?: AuthUser;
      sessionId?: string;
      student?: JoinedStudent;
    }
  }
}

export {};
