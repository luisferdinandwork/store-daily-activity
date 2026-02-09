// app/auth.ts
import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from '../lib/db';
import { users } from '../lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { getServerSession } from 'next-auth/next';

export const authOptions: NextAuthOptions = {
  // Add a secret for JWT signing/encryption
  secret: process.env.NEXTAUTH_SECRET,
  
  adapter: DrizzleAdapter(db) as any, // Type assertion to bypass adapter incompatibility
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await db
          .select()
          .from(users)
          .where(eq(users.email, credentials.email))
          .limit(1);

        if (!user.length) {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user[0].password
        );

        if (!isPasswordValid) {
          return null;
        }

        // Convert null values to undefined to match NextAuth expectations
        return {
          id: user[0].id,
          name: user[0].name,
          email: user[0].email,
          role: user[0].role,
          employeeType: user[0].employeeType || undefined,
          storeId: user[0].storeId || undefined,
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  jwt: {
    maxAge: 30 * 24 * 60 * 60, // 30 days
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
      if (token) {
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
};

// Add this function to export auth
export const auth = () => getServerSession(authOptions);