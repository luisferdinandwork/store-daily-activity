// types/next-auth.d.ts
import type { DefaultSession } from 'next-auth';
import type { DefaultJWT } from 'next-auth/jwt';

type AppRole = 'employee' | 'ops' | 'finance' | 'admin' | string;
type AppEmployeeType =
  | 'pic_1'
  | 'pic_2'
  | 'sa'
  | 'ops_area'
  | 'ops_ho'
  | string
  | null;

declare module 'next-auth' {
  interface User {
    id: string;
    nik: string;
    name: string;

    role: AppRole;
    roleLabel: string;

    employeeType: AppEmployeeType;
    employeeTypeLabel: string | null;

    homeStoreId: number | null;
    areaId: number | null;

    canViewAllStores: boolean;
    isOpsHo: boolean;
    isOpsArea: boolean;
  }

  interface Session {
    user: {
      id: string;
      nik: string;

      role: AppRole;
      roleLabel: string;

      employeeType: AppEmployeeType;
      employeeTypeLabel: string | null;

      homeStoreId: number | null;
      areaId: number | null;

      canViewAllStores: boolean;
      isOpsHo: boolean;
      isOpsArea: boolean;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id: string;
    nik: string;

    role: AppRole;
    roleLabel: string;

    employeeType: AppEmployeeType;
    employeeTypeLabel: string | null;

    homeStoreId: number | null;
    areaId: number | null;

    canViewAllStores: boolean;
    isOpsHo: boolean;
    isOpsArea: boolean;
  }
}