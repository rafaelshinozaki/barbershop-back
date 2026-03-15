import { UserDTO } from '@/auth/users/dto/user.dto';
import { Role } from './src/auth/interfaces/roles';

declare module 'express-session' {
  interface SessionData {
    user: {
      userId: number;
      email: string;
      roles: [Role];
    };
  }
}

declare module 'express' {
  interface Request {
    user: UserDTO;
  }
}
