// lib/auth.ts
import { NextAuthOptions } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getServerSession } from 'next-auth/next';
import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import bcrypt from 'bcryptjs';

import { db } from '@/lib/db';
import { users, userRoles, employeeTypes } from '@/lib/db/schema';
import {
  clearLoginFailures,
  clientIpFromHeaders,
  isLoginBlocked,
  recordLoginFailure,
} from '@/lib/auth/rate-limit';

const switchedFromRole = alias(userRoles, 'switched_from_role');

/**
 * A valid bcrypt hash of a random string. Compared against when the NIK doesn't
 * exist so that "unknown NIK" and "wrong password" take the same time — otherwise
 * response latency reveals which NIKs are real.
 */
const DUMMY_BCRYPT_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8cIOBWjBHZpdmSGVsn0JZ6aJfL3YLu';

/** bcrypt ignores everything past 72 bytes; refuse absurd inputs instead of hashing them. */
const MAX_PASSWORD_LENGTH = 200;

/**
 * How long a session may keep trusting the role/active flags baked into its JWT
 * before they are re-read from the DB. Bounds how long a deactivated, demoted or
 * transferred user keeps stale access.
 */
const REVALIDATE_AFTER_MS = 30_000;

/** Re-reads a user's current role/employeeType/switch state from the DB. */
async function loadUserAuthFields(userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      nik: users.nik,
      name: users.name,
      avatarUrl: users.avatarUrl,
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
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;

  const role = row.roleCode;
  const employeeType = row.employeeTypeCode ?? null;

  // Same conditions authorize() enforces at login — applied again on every
  // revalidation so a session can't outlive its account.
  const eligible =
    row.isActive &&
    row.roleActive &&
    !(row.employeeTypeId && !row.employeeTypeActive) &&
    !(isOpsArea(role, employeeType) && !row.areaId);

  return {
    id: row.id,
    nik: row.nik,
    name: row.name,
    image: row.avatarUrl ?? null,
    eligible,

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

type FreshAuthFields = NonNullable<Awaited<ReturnType<typeof loadUserAuthFields>>>;

// Tiny per-process cache so a burst of parallel API calls from one page (each of
// which runs the jwt callback) costs one lookup, not one per request.
const FRESH_CACHE_TTL_MS = 15_000;
const freshCache = new Map<string, { at: number; value: FreshAuthFields | null }>();

async function loadFreshAuthFields(userId: string, force: boolean): Promise<FreshAuthFields | null> {
  const now = Date.now();
  const hit = freshCache.get(userId);
  if (!force && hit && now - hit.at < FRESH_CACHE_TTL_MS) return hit.value;

  const value = await loadUserAuthFields(userId);

  if (freshCache.size > 5_000) freshCache.clear(); // hard bound; it's only a cache
  freshCache.set(userId, { at: now, value });
  return value;
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

/** Copies the permission-bearing fields onto the JWT (shared by sign-in and revalidation). */
function copyAuthFields(
  token: JWT,
  src: Pick<
    FreshAuthFields,
    | 'image'
    | 'role'
    | 'roleLabel'
    | 'employeeType'
    | 'employeeTypeLabel'
    | 'homeStoreId'
    | 'areaId'
    | 'canViewAllStores'
    | 'isOpsHo'
    | 'isOpsArea'
    | 'switchedFromRoleId'
    | 'switchedFromRoleCode'
    | 'switchedFromRoleLabel'
  >,
) {
  token.picture = src.image ?? null;
  token.role = src.role;
  token.roleLabel = src.roleLabel;

  token.employeeType = src.employeeType;
  token.employeeTypeLabel = src.employeeTypeLabel;

  token.homeStoreId = src.homeStoreId;
  token.areaId = src.areaId;

  token.canViewAllStores = src.canViewAllStores;
  token.isOpsHo = src.isOpsHo;
  token.isOpsArea = src.isOpsArea;

  token.switchedFromRoleId = src.switchedFromRoleId;
  token.switchedFromRoleCode = src.switchedFromRoleCode;
  token.switchedFromRoleLabel = src.switchedFromRoleLabel;
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

      async authorize(credentials, req) {
        try {
          const nik = credentials?.nik ? normalizeNik(credentials.nik) : '';

          if (!nik || !credentials?.password) {
            return null;
          }

          if (nik.length > 64 || credentials.password.length > MAX_PASSWORD_LENGTH) {
            return null;
          }

          // Brute-force protection. Thrown (rather than `return null`) so the client
          // can tell "locked out" apart from "wrong password" — see login-form.tsx.
          const ip = clientIpFromHeaders(req?.headers as Record<string, unknown> | undefined);
          if (isLoginBlocked(nik, ip)) {
            console.warn(`[auth] login throttled for NIK ${nik} from ${ip}`);
            throw new Error('TooManyAttempts');
          }

          const result = await db
            .select({
              id: users.id,
              nik: users.nik,
              name: users.name,
              password: users.password,
              avatarUrl: users.avatarUrl,
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

          const u = result[0];

          // Always run exactly one bcrypt comparison — against a dummy hash when the NIK
          // is unknown — and only then look at account state, so neither an unknown NIK
          // nor a disabled account is distinguishable from a wrong password by timing.
          const passwordOk = await bcrypt.compare(
            credentials.password,
            u?.password ?? DUMMY_BCRYPT_HASH,
          );

          if (
            !u ||
            !passwordOk ||
            !u.isActive ||
            !u.roleActive ||
            (u.employeeTypeId && !u.employeeTypeActive)
          ) {
            log('❌ Login rejected for NIK:', nik);
            recordLoginFailure(nik, ip);
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

          clearLoginFailures(nik, ip);
          log('✅ Login OK for NIK:', nik);

          return {
            id: u.id,
            nik: u.nik,
            name: u.name,
            image: u.avatarUrl ?? null,

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
          // Surface the lockout to the client; every other failure looks like "bad credentials".
          if (error instanceof Error && error.message === 'TooManyAttempts') throw error;
          console.error('💥 Authorization error:', error);
          return null;
        }
      },
    }),
  ],

  session: {
    strategy: 'jwt',
    // 15-minute idle timeout. The JWT expires 15 min after it was last
    // issued; an active client re-issues it (extending the window) via the
    // SessionProvider's `refetchInterval` poll + refetch-on-focus (every
    // /api/auth/session read re-encodes the JWT with a fresh expiry). Once the
    // client stops polling (tab hidden / user gone) the token lapses after
    // 15 min. `components/idle-logout-watcher.tsx` enforces the same 15-minute
    // idle cut-off on the client. Because the window slides, the `jwt`
    // callback below re-validates the account against the DB every
    // REVALIDATE_AFTER_MS so a stolen/stale cookie can't outlive its account.
    maxAge: 15 * 60,
    updateAge: 60,
  },

  callbacks: {
    async jwt({ token, user, trigger }) {
      // Sign-in: the user object was just built from a fresh DB read in authorize().
      if (user) {
        token.id = user.id;
        token.nik = user.nik;
        copyAuthFields(token, user);
        token.authCheckedAt = Date.now();
        return token;
      }

      // A token without an id can't be tied to an account.
      if (!token.id) throw new Error('SessionRevoked');

      // Re-validate against the DB when (a) the client called useSession().update() —
      // used by the IT role-switch to reflect a DB-side role change immediately — or
      // (b) the last check is older than REVALIDATE_AFTER_MS. This is what makes a
      // deactivated / demoted / transferred user lose (or change) access promptly
      // instead of keeping a rolling JWT alive indefinitely.
      const forced = trigger === 'update';
      const due =
        forced ||
        typeof token.authCheckedAt !== 'number' ||
        Date.now() - token.authCheckedAt > REVALIDATE_AFTER_MS;
      if (!due) return token;

      let fresh: FreshAuthFields | null;
      try {
        fresh = await loadFreshAuthFields(token.id, forced);
      } catch (err) {
        // Database hiccup: don't sign every user out because Postgres blinked. Handlers
        // that need the DB fail on their own; we simply retry on the next call.
        console.error('[auth] session revalidation failed — keeping existing token:', err);
        return token;
      }

      // Throwing makes NextAuth return "no session" and clear the cookie on the next
      // /api/auth/session poll. Both client and server code then see a signed-out user.
      if (!fresh || !fresh.eligible) throw new Error('SessionRevoked');

      copyAuthFields(token, fresh);
      token.authCheckedAt = Date.now();
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.nik = token.nik;
        session.user.image = (token.picture as string | null | undefined) ?? null;
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