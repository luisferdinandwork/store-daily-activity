// app/api/auth/register/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

export async function POST(request: Request) {
  try {
    const { name, email, password, role, employeeType, storeId } = await request.json();

    // Check if user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser.length > 0) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const newUser = await db
      .insert(users)
      .values({
        name,
        email,
        password: hashedPassword,
        role,
        employeeType,
        storeId,
      })
      .returning();

    // Remove password from response
    const { password: _, ...userWithoutPassword } = newUser[0];

    return NextResponse.json({ user: userWithoutPassword }, { status: 201 });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'An error occurred during registration' },
      { status: 500 }
    );
  }
}