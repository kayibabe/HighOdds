export default function SignIn() {
  return <section className="sign-in"><p className="eyebrow">SUBSCRIBER ACCESS</p><h1>Sign in</h1><p>Subscribers receive an email magic link after an administrator has activated access. Payments and subscriptions are not active during paper validation.</p><form action="/api/auth/signin/resend" method="post"><label>Email<input type="email" name="email" required autoComplete="email" /></label><button type="submit">Email me a sign-in link</button></form></section>;
}
