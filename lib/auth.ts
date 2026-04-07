// lib/auth.ts
import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '@/lib/db';
import { users, userRoles, employeeTypes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { getServerSession } from 'next-auth/next';

const isDev = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => { if (isDev) console.log(...args); };

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,

  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) return null;

          // Join users → userRoles, left-join employeeTypes (nullable for ops/admin)
          const result = await db
            .select({
              id:               users.id,
              name:             users.name,
              email:            users.email,
              password:         users.password,
              homeStoreId:      users.homeStoreId,
              areaId:           users.areaId,
              roleId:           users.roleId,
              roleCode:         userRoles.code,
              roleLabel:        userRoles.label,
              roleActive:       userRoles.isActive,
              employeeTypeId:   users.employeeTypeId,
              employeeTypeCode: employeeTypes.code,
              employeeTypeLabel:employeeTypes.label,
            })
            .from(users)
            .innerJoin(userRoles, eq(userRoles.id, users.roleId))
            .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
            .where(eq(users.email, credentials.email))
            .limit(1);

          if (!result.length) {
            log('❌ No user found:', credentials.email);
            return null;
          }

          const u = result[0];

          if (!u.roleActive) {
            log('❌ Role disabled for user:', credentials.email);
            return null;
          }

          const ok = await bcrypt.compare(credentials.password, u.password);
          if (!ok) {
            log('❌ Invalid password:', credentials.email);
            return null;
          }

          log('✅ Login OK:', credentials.email);

          return {
            id:                u.id,
            name:              u.name,
            email:             u.email,
            role:              u.roleCode,                    // stable code, e.g. 'ops'
            roleLabel:         u.roleLabel,
            employeeType:      u.employeeTypeCode ?? null,    // e.g. 'pic_1' or null
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

  pages: { signIn: '/login' },
  debug: isDev,
};

export const auth = () => getServerSession(authOptions);