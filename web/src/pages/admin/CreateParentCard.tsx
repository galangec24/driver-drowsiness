import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createParent } from '../../api/admin';
import { errorMessage } from '../../api/client';
import { GlassCard } from '../../components/ui/GlassCard';
import { DepthButton } from '../../components/ui/DepthButton';
import { Icon } from '../../components/ui/Icon';

const input =
  'h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white shadow-inner outline-none focus:border-accent-glow/70';

/**
 * Admin > Parents > "Create parent account": a temporary password is e-mailed to the parent (and
 * shown here once). They must choose their own at first sign-in. TESTING PHASE: these accounts
 * get the phone driver monitor on their drivers.
 */
export function CreateParentCard() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [done, setDone] = useState<{ email: string; password: string; emailSent: boolean } | null>(null);
  const create = useMutation({
    mutationFn: createParent,
    onSuccess: (res) => {
      setDone({ email: res.user.email, password: res.temporaryPassword, emailSent: res.emailSent });
      setName('');
      setEmail('');
      setPhone('');
      void qc.invalidateQueries({ queryKey: ['admin', 'parents'] });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setDone(null);
    create.mutate({ name: name.trim(), email: email.trim(), ...(phone.trim() && { phone: phone.trim() }) });
  }

  return (
    <GlassCard interactive={false} data-testid="create-parent">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-white">Create parent account</h2>
          <p className="text-sm text-ink-muted">
            For test families: they get a temporary password by e-mail, choose their own at first sign-in, and get the
            phone driver monitor for their drivers.
          </p>
        </div>
        {!open && (
          <DepthButton icon={<Icon name="plus" size={16} />} onClick={() => setOpen(true)}>
            New parent
          </DepthButton>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-3">
          <input className={input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input
            className={input}
            type="email"
            placeholder="E-mail (must be real: the password goes there)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className={input}
            type="tel"
            placeholder="Mobile number (optional)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <div className="flex gap-2 sm:col-span-3">
            <DepthButton type="submit" loading={create.isPending} disabled={!name.trim() || !email.trim()}>
              Create account
            </DepthButton>
            <DepthButton type="button" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </DepthButton>
          </div>
        </form>
      )}

      {create.isError && <p className="mt-3 text-sm text-amber-300">{errorMessage(create.error)}</p>}
      {done && (
        <div className="mt-4 rounded-xl bg-white/5 p-3 text-sm" data-testid="create-parent-done">
          <p className="text-white">
            Account created for <b>{done.email}</b>.{' '}
            {done.emailSent
              ? 'The temporary password was e-mailed to them.'
              : 'The e-mail could not be sent: give them this password yourself.'}
          </p>
          <p className="mt-2 text-ink-muted">
            Temporary password (shown once):{' '}
            <span className="select-all rounded bg-black/40 px-2 py-0.5 font-mono text-base text-white">
              {done.password}
            </span>
          </p>
        </div>
      )}
    </GlassCard>
  );
}
