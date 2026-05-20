// types/next-auth.d.ts
import { DefaultSession, DefaultUser } from 'next-auth';
import { JWT as DefaultJWT } from 'next-auth/jwt';

declare module 'next-auth' {
  interface User extends DefaultUser {
    id:                string;
    nik:               string;
    role:              string;
    roleLabel:         string;
    employeeType:      string | null;
    employeeTypeLabel: string | null;
    homeStoreId:       number | null;
    areaId:            number | null;
  }

  interface Session {
    user: {
      id:                string;
      nik:               string;
      role:              string;
      roleLabel:         string;
      employeeType:      string | null;
      employeeTypeLabel: string | null;
      homeStoreId:       number | null;
      areaId:            number | null;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id:                string;
    nik:               string;
    role:              string;
    roleLabel:         string;
    employeeType:      string | null;
    employeeTypeLabel: string | null;
    homeStoreId:       number | null;
    areaId:            number | null;
  }
}