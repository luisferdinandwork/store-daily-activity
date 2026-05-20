// lib/auth.ts
import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getServerSession } from 'next-auth/next';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

import { db } from '@/lib/db';
import { users, userRoles, employeeTypes } from '@/lib/db/schema';

const isDev = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => {
  if (isDev) console.log(...args);
};

function normalizeNik(value: string): string {
  return value.trim();
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,

  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        nik:      { label: 'NIK',      type: 'text' },
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
              id:                users.id,
              nik:               users.nik,
              name:              users.name,
              password:          users.password,
              isActive:          users.isActive,
              homeStoreId:       users.homeStoreId,
              areaId:            users.areaId,
              roleId:            users.roleId,
              roleCode:          userRoles.code,
              roleLabel:         userRoles.label,
              roleActive:        userRoles.isActive,
              employeeTypeId:    users.employeeTypeId,
              employeeTypeCode:  employeeTypes.code,
              employeeTypeLabel: employeeTypes.label,
            })
            .from(users)
            .innerJoin(userRoles, eq(userRoles.id, users.roleId))
            .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
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

          const ok = await bcrypt.compare(credentials.password, u.password);
          if (!ok) {
            log('❌ Invalid password for NIK:', nik);
            return null;
          }

          log('✅ Login OK for NIK:', nik);

          return {
            id:                u.id,
            nik:               u.nik,
            name:              u.name,
            role:              u.roleCode,
            roleLabel:         u.roleLabel,
            employeeType:      u.employeeTypeCode ?? null,
            employeeTypeLabel: u.employeeTypeLabel ?? null,
            homeStoreId:       u.homeStoreId ?? null,
            areaId:            u.areaId ?? null,
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
    maxAge: 30 * 24 * 60 * 60,
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id                = user.id;
        token.nik               = user.nik;
        token.role              = user.role;
        token.roleLabel         = user.roleLabel;
        token.employeeType      = user.employeeType;
        token.employeeTypeLabel = user.employeeTypeLabel;
        token.homeStoreId       = user.homeStoreId;
        token.areaId            = user.areaId;
      }

      return token;
    },

    async session({ session, token }) {
      if (token && session.user) {
        session.user.id                = token.id;
        session.user.nik               = token.nik;
        session.user.role              = token.role;
        session.user.roleLabel         = token.roleLabel;
        session.user.employeeType      = token.employeeType;
        session.user.employeeTypeLabel = token.employeeTypeLabel;
        session.user.homeStoreId       = token.homeStoreId;
        session.user.areaId            = token.areaId;
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