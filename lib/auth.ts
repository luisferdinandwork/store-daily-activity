// lib/auth.ts
import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getServerSession } from 'next-auth/next';
import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import bcrypt from 'bcryptjs';

import { db } from '@/lib/db';
import { users, userRoles, employeeTypes } from '@/lib/db/schema';

const switchedFromRole = alias(userRoles, 'switched_from_role');

/** Re-reads a user's current role/employeeType/switch state from the DB. */
async function loadUserAuthFields(userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      nik: users.nik,
      name: users.name,

      homeStoreId: users.homeStoreId,
      areaId: users.areaId,

      roleId: users.roleId,
      roleCode: userRoles.code,
      roleLabel: userRoles.label,
      roleActive: userRoles.isActive,

      employeeTypeId: users.employeeTypeId,
      employeeTypeCode: employeeTypes.code,
      employeeTypeLabel: employeeTypes.label,
      employeeTypeActive: employeeTypes.isActive,

      switchedFromRoleId: users.switchedFromRoleId,
      switchedFromRoleCode: switchedFromRole.code,
      switchedFromRoleLabel: switchedFromRole.label,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
    .leftJoin(switchedFromRole, eq(switchedFromRole.id, users.switchedFromRoleId))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;

  const role = row.roleCode;
  const employeeType = row.employeeTypeCode ?? null;

  return {
    id: row.id,
    nik: row.nik,
    name: row.name,

    role,
    roleLabel: row.roleLabel,

    employeeType,
    employeeTypeLabel: row.employeeTypeLabel ?? null,

    homeStoreId: row.homeStoreId ?? null,
    areaId: row.areaId ?? null,

    canViewAllStores: hasAllStoreAccess(role, employeeType),
    isOpsHo: employeeType === 'ops_ho',
    isOpsArea: employeeType === 'ops_area',

    switchedFromRoleId: row.switchedFromRoleId ?? null,
    switchedFromRoleCode: row.switchedFromRoleCode ?? null,
    switchedFromRoleLabel: row.switchedFromRoleLabel ?? null,
  };
}

const isDev = process.env.NODE_ENV === 'development';

const log = (...args: unknown[]) => {
  if (isDev) console.log(...args);
};

function normalizeNik(value: string): string {
  return value.trim();
}

function hasAllStoreAccess(role: string | null | undefined, employeeType: string | null | undefined) {
  return role === 'it' || employeeType === 'ops_ho';
}

function isOpsArea(role: string | null | undefined, employeeType: string | null | undefined) {
  return role === 'ops' && employeeType === 'ops_area';
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,

  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        nik: { label: 'NIK', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(credentials) {
        try {
          const nik = credentials?.nik ? normalizeNik(credentials.nik) : '';

          if (!nik || !credentials?.password) {
            return null;
          }

          const result = await db
            .select({
              id: users.id,
              nik: users.nik,
              name: users.name,
              password: users.password,
              isActive: users.isActive,

              homeStoreId: users.homeStoreId,
              areaId: users.areaId,

              roleId: users.roleId,
              roleCode: userRoles.code,
              roleLabel: userRoles.label,
              roleActive: userRoles.isActive,

              employeeTypeId: users.employeeTypeId,
              employeeTypeCode: employeeTypes.code,
              employeeTypeLabel: employeeTypes.label,
              employeeTypeActive: employeeTypes.isActive,

              switchedFromRoleId: users.switchedFromRoleId,
              switchedFromRoleCode: switchedFromRole.code,
              switchedFromRoleLabel: switchedFromRole.label,
            })
            .from(users)
            .innerJoin(userRoles, eq(userRoles.id, users.roleId))
            .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
            .leftJoin(switchedFromRole, eq(switchedFromRole.id, users.switchedFromRoleId))
            .where(eq(users.nik, nik))
            .limit(1);

          if (!result.length) {
            log('❌ No user found for NIK:', nik);
            return null;
          }

          const u = result[0];

          if (!u.isActive) {
            log('❌ User disabled for NIK:', nik);
            return null;
          }

          if (!u.roleActive) {
            log('❌ Role disabled for NIK:', nik);
            return null;
          }

          if (u.employeeTypeId && !u.employeeTypeActive) {
            log('❌ Employee type disabled for NIK:', nik);
            return null;
          }

          const ok = await bcrypt.compare(credentials.password, u.password);

          if (!ok) {
            log('❌ Invalid password for NIK:', nik);
            return null;
          }

          const role = u.roleCode;
          const employeeType = u.employeeTypeCode ?? null;

          /**
           * Area ops must have an areaId.
           * HO ops and admin may have areaId = null because they can view all stores.
           */
          if (isOpsArea(role, employeeType) && !u.areaId) {
            log('❌ ops_area user has no areaId:', nik);
            return null;
          }

          const canViewAllStores = hasAllStoreAccess(role, employeeType);

          log('✅ Login OK for NIK:', nik);

          return {
            id: u.id,
            nik: u.nik,
            name: u.name,

            role,
            roleLabel: u.roleLabel,

            employeeType,
            employeeTypeLabel: u.employeeTypeLabel ?? null,

            homeStoreId: u.homeStoreId ?? null,
            areaId: u.areaId ?? null,

            canViewAllStores,
            isOpsHo: employeeType === 'ops_ho',
            isOpsArea: employeeType === 'ops_area',

            switchedFromRoleId: u.switchedFromRoleId ?? null,
            switchedFromRoleCode: u.switchedFromRoleCode ?? null,
            switchedFromRoleLabel: u.switchedFromRoleLabel ?? null,
          };
        } catch (error) {
          console.error('💥 Authorization error:', error);
          return null;
        }
      },
    }),
  ],

  session: {
    strategy: 'jwt',
    // Absolute cap on a session's lifetime; refreshed by `updateAge` below
    // whenever the client is actually active, so in practice this behaves
    // as a 6-hour idle timeout rather than a fixed 6-hour login.
    maxAge: 6 * 60 * 60,
    updateAge: 5 * 60,
  },

  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.nik = user.nik;
        token.role = user.role;
        token.roleLabel = user.roleLabel;

        token.employeeType = user.employeeType;
        token.employeeTypeLabel = user.employeeTypeLabel;

        token.homeStoreId = user.homeStoreId;
        token.areaId = user.areaId;

        token.canViewAllStores = user.canViewAllStores;
        token.isOpsHo = user.isOpsHo;
        token.isOpsArea = user.isOpsArea;

        token.switchedFromRoleId = user.switchedFromRoleId;
        token.switchedFromRoleCode = user.switchedFromRoleCode;
        token.switchedFromRoleLabel = user.switchedFromRoleLabel;
      }

      // Triggered by the client calling useSession().update() — used by the
      // IT role-switch feature to reflect a DB-side role change into the
      // live session immediately, without a full logout/login.
      if (trigger === 'update' && token.id) {
        const fresh = await loadUserAuthFields(token.id as string);
        if (fresh) {
          token.role = fresh.role;
          token.roleLabel = fresh.roleLabel;

          token.employeeType = fresh.employeeType;
          token.employeeTypeLabel = fresh.employeeTypeLabel;

          token.homeStoreId = fresh.homeStoreId;
          token.areaId = fresh.areaId;

          token.canViewAllStores = fresh.canViewAllStores;
          token.isOpsHo = fresh.isOpsHo;
          token.isOpsArea = fresh.isOpsArea;

          token.switchedFromRoleId = fresh.switchedFromRoleId;
          token.switchedFromRoleCode = fresh.switchedFromRoleCode;
          token.switchedFromRoleLabel = fresh.switchedFromRoleLabel;
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.nik = token.nik;
        session.user.role = token.role;
        session.user.roleLabel = token.roleLabel;

        session.user.employeeType = token.employeeType;
        session.user.employeeTypeLabel = token.employeeTypeLabel;

        session.user.homeStoreId = token.homeStoreId;
        session.user.areaId = token.areaId;

        session.user.canViewAllStores = token.canViewAllStores;
        session.user.isOpsHo = token.isOpsHo;
        session.user.isOpsArea = token.isOpsArea;

        session.user.switchedFromRoleId = token.switchedFromRoleId;
        session.user.switchedFromRoleCode = token.switchedFromRoleCode;
        session.user.switchedFromRoleLabel = token.switchedFromRoleLabel;
      }

      return session;
    },
  },

  pages: {
    signIn: '/login',
  },

  debug: isDev,
};

export const auth = () => getServerSession(authOptions);