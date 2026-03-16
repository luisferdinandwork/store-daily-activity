// lib/auth.ts
import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { getServerSession } from 'next-auth/next';

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
          console.log('🔐 Login attempt for:', credentials?.email);

          if (!credentials?.email || !credentials?.password) {
            console.log('❌ Missing credentials');
            return null;
          }

          const userResult = await db
            .select()
            .from(users)
            .where(eq(users.email, credentials.email))
            .limit(1);

          console.log('👤 User found:', userResult.length > 0);

          if (!userResult.length) {
            console.log('❌ No user found with email:', credentials.email);
            return null;
          }

          const user = userResult[0];
          console.log('🔍 User details:', {
            id:           user.id,
            email:        user.email,
            role:         user.role,
            employeeType: user.employeeType,
            homeStoreId:  user.homeStoreId,   // ← was storeId
            areaId:       user.areaId,
            hasPassword:  !!user.password,
          });

          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password,
          );

          console.log('🔑 Password valid:', isPasswordValid);

          if (!isPasswordValid) {
            console.log('❌ Invalid password for user:', credentials.email);
            return null;
          }

          console.log('✅ Login successful for:', credentials.email);

          return {
            id:           user.id,
            name:         user.name,
            email:        user.email,
            role:         user.role,
            employeeType: user.employeeType ?? undefined,
            homeStoreId:  user.homeStoreId  ?? undefined,  // ← was storeId
            areaId:       user.areaId       ?? undefined,
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
        token.role         = (user as any).role;
        token.employeeType = (user as any).employeeType;
        token.homeStoreId  = (user as any).homeStoreId;  // ← was storeId
        token.areaId       = (user as any).areaId ?? null;
      }
      return token;
    },

    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).id           = token.sub!;
        (session.user as any).role         = token.role         as string;
        (session.user as any).employeeType = token.employeeType as string | undefined;
        (session.user as any).homeStoreId  = token.homeStoreId  as string | undefined;  // ← was storeId
        (session.user as any).areaId       = token.areaId       as string | null;
      }
      return session;
    },
  },

  pages: {
    signIn: '/login',
  },

  debug: process.env.NODE_ENV === 'development',
};

export const auth = () => getServerSession(authOptions);