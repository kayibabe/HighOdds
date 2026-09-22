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
