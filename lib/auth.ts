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
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          console.log('🔐 Login attempt for:', credentials?.email);

          if (!credentials?.email || !credentials?.password) {
            console.log('❌ Missing credentials');
            return null;
          }

          // Check database connection and user
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
            id: user.id,
            email: user.email,
            role: user.role,
            hasPassword: !!user.password
          });

          // Verify password
          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password
          );

          console.log('🔑 Password valid:', isPasswordValid);

          if (!isPasswordValid) {
            console.log('❌ Invalid password for user:', credentials.email);
            return null;
          }

          console.log('✅ Login successful for:', credentials.email);

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            employeeType: user.employeeType || undefined,
            storeId: user.storeId || undefined,
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
        token.role = user.role;
        token.employeeType = user.employeeType;
        token.storeId = user.storeId;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.sub!;
        session.user.role = token.role as string;
        session.user.employeeType = token.employeeType as string | undefined;
        session.user.storeId = token.storeId as string | undefined;
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