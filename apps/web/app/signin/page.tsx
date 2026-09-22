import { adminSignIn } from "./actions";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <section className="sign-in">
      <p className="eyebrow">SUBSCRIBER ACCESS</p>
      <h1>Sign in</h1>
      <p>Subscribers receive an email magic link after an administrator has activated access. Payments and subscriptions are not active during paper validation.</p>
      <form action="/api/auth/signin/resend" method="post">
        <label>Email<input type="email" name="email" required autoComplete="email" /></label>
        <button type="submit">Email me a sign-in link</button>
      </form>

      <p className="eyebrow" style={{ marginTop: 48 }}>ADMIN ACCESS</p>
      <h2>Admin sign in</h2>
      {error === "invalid-credentials" && <div className="notice" role="alert">Incorrect email or password.</div>}
      <form action={adminSignIn}>
        <label>Email<input type="email" name="email" required autoComplete="email" /></label>
        <label>Password<input type="password" name="password" required autoComplete="current-password" /></label>
        <button type="submit">Sign in as admin</button>
      </form>
    </section>
  );
}
