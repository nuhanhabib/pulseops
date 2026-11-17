import { z } from "zod";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../constants";

/** Passwords seen so often in breach corpora that length alone does not save them. */
const COMMON_PASSWORDS = new Set([
  "1234567890",
  "12345678910",
  "123456789a",
  "1q2w3e4r5t",
  "1qaz2wsx3edc",
  "abcdefghij",
  "administrator",
  "iloveyou123",
  "letmein1234",
  "password12",
  "password123",
  "password1234",
  "passw0rd123",
  "qwerty12345",
  "qwertyuiop",
  "qwertyuiop1",
  "welcome1234",
  "changeme123",
]);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address.").max(254, "That email address is too long."));

/**
 * Length-first policy (NIST SP 800-63B): a long minimum, a generous maximum,
 * a breached-password denylist, and one cheap variety check. No forced
 * rotation and no composition rules beyond "not all one kind of character".
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`)
  .refine((value) => /[a-zA-Z]/.test(value) && /[^a-zA-Z]/.test(value), {
    error: "Mix letters with at least one number or symbol.",
  })
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), {
    error: "That password is too common. Choose something less predictable.",
  });

export const nameSchema = z
  .string()
  .trim()
  .min(2, "Enter your name.")
  .max(80, "Keep your name under 80 characters.");

export const organizationNameSchema = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(60, "Keep the name under 60 characters.");

export const registerSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    organizationName: organizationNameSchema,
    /** Present when signing up from an invitation link: skips workspace creation. */
    invitationToken: z.string().min(20).max(200).optional(),
  })
  .refine((input) => input.password.toLowerCase() !== input.email, {
    error: "Your password cannot be your email address.",
    path: ["password"],
  });

export const loginSchema = z.object({
  email: emailSchema,
  // Deliberately not `passwordSchema`: never reveal the policy on sign-in, and
  // never lock out accounts created under an older, weaker policy.
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX_LENGTH),
});

export const updateProfileSchema = z.object({
  name: nameSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema,
  })
  .refine((input) => input.currentPassword !== input.newPassword, {
    error: "Choose a password you are not already using.",
    path: ["newPassword"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Rough strength estimate for the sign-up meter. Guidance only, never a gate. */
export function estimatePasswordStrength(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!password) return { score: 0, label: "" };
  let points = 0;
  if (password.length >= PASSWORD_MIN_LENGTH) points += 1;
  if (password.length >= 14) points += 1;
  if (password.length >= 20) points += 1;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((pattern) => pattern.test(password)).length;
  if (classes >= 3) points += 1;
  if (new Set(password).size < 6 || COMMON_PASSWORDS.has(password.toLowerCase())) points = Math.min(points, 1);
  const score = Math.min(4, points) as 0 | 1 | 2 | 3 | 4;
  return { score, label: ["Too short", "Weak", "Fair", "Good", "Strong"][score] ?? "" };
}
