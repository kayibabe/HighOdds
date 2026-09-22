"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "../../auth";

export async function adminSignIn(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    await signIn("credentials", { email, password, redirectTo: "/admin" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/signin?error=invalid-credentials");
    throw error;
  }
}

/**
 * A raw <form method="post" action="/api/auth/signin/resend"> fails NextAuth's own CSRF check on
 * every submission (MissingCSRF) because it never embeds a csrfToken field. Going through the
 * signIn() server action instead, the same way adminSignIn() already does, sidesteps that: it
 * handles the CSRF/cookie exchange internally without a manual token field.
 */
export async function subscriberSignIn(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  try {
    await signIn("resend", { email, redirectTo: "/signin?sent=1" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/signin?error=email-send-failed");
    throw error;
  }
}
