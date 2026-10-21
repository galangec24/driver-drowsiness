import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useMutation } from '@tanstack/react-query';
import { deleteDriver, requestDeleteCode, type DeleteCodeResult } from '../../api/drivers';
import { errorMessage } from '../../api/client';
import { DepthButton } from '../ui/DepthButton';
import { Icon } from '../ui/Icon';

/**
 * Deleting a driver removes their face profile, photos, alerts and readings, so it needs a 6-digit
 * code e-mailed to the account owner (or, when the server has no e-mail set up, the driver's name).
 */
export function DeleteDriverDialog({
  driverId,
  driverName,
  onClose,
  onDeleted,
}: {
  driverId: string;
  driverName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [how, setHow] = useState<DeleteCodeResult | null>(null);
  const [value, setValue] = useState('');
  const [wait, setWait] = useState(0);

  const ask = useMutation({
    mutationFn: () => requestDeleteCode(driverId),
    onSuccess: (r) => {
      setHow(r);
      if (r.method === 'email') setWait(r.retryAfterS);
    },
  });
  const del = useMutation({
    mutationFn: () => deleteDriver(driverId, how?.method === 'email' ? { code: value.trim() } : { confirmName: value }),
    onSuccess: onDeleted,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  const ready = how?.method === 'email' ? /^\d{6}$/.test(value.trim()) : value.trim().length > 0;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${driverName}`}
        data-testid="delete-driver-dialog"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="glass w-full max-w-md rounded-b-none bg-ink-900/95 p-6 shadow-depth-3 sm:rounded-2xl"
      >
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-danger/15 text-red-300">
            <Icon name="trash" size={22} />
          </span>
          <div>
            <h2 className="text-lg font-bold text-white">Delete {driverName}?</h2>
            <p className="text-xs text-ink-muted">This can't be undone.</p>
          </div>
        </div>
        <p className="mb-4 text-sm text-ink-muted">
          Their face profile, photos, alerts, messages and reading history are deleted for good, and the car stops
          recognising them.
        </p>

        {!how && (
          <>
            <p className="mb-4 text-sm text-white/90">
              To make sure it's really you, we'll e-mail a 6-digit code to your account.
            </p>
            {ask.isError && <p className="mb-3 text-sm text-red-300">{errorMessage(ask.error)}</p>}
            <div className="flex justify-end gap-2">
              <DepthButton variant="secondary" onClick={onClose}>
                Cancel
              </DepthButton>
              <DepthButton
                variant="danger"
                icon={<Icon name="mail" size={18} />}
                loading={ask.isPending}
                onClick={() => ask.mutate()}
              >
                Send code
              </DepthButton>
            </div>
          </>
        )}

        {how && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) del.mutate();
            }}
            className="flex flex-col gap-3"
          >
            {how.method === 'email' ? (
              <p className="text-sm text-white/90" data-testid="code-sent">
                We sent a code to <b>{how.email}</b>. Enter it below to delete {driverName}.
              </p>
            ) : (
              <p className="text-sm text-white/90">
                Type <b>{driverName}</b> to confirm.
              </p>
            )}
            <input
              autoFocus
              aria-label={how.method === 'email' ? 'Confirmation code' : 'Driver name'}
              inputMode={how.method === 'email' ? 'numeric' : 'text'}
              autoComplete={how.method === 'email' ? 'one-time-code' : 'off'}
              maxLength={how.method === 'email' ? 6 : 80}
              placeholder={how.method === 'email' ? '6-digit code' : driverName}
              value={value}
              onChange={(e) => setValue(how.method === 'email' ? e.target.value.replace(/\D/g, '') : e.target.value)}
              className={`h-12 rounded-xl border border-white/10 bg-black/25 px-4 text-white outline-none focus:border-accent-danger/70 ${
                how.method === 'email' ? 'text-center text-xl font-bold tracking-[0.5em]' : ''
              }`}
            />
            {del.isError && <p className="text-sm text-red-300">{errorMessage(del.error)}</p>}
            {how.method === 'email' && (
              <button
                type="button"
                disabled={wait > 0 || ask.isPending}
                onClick={() => ask.mutate()}
                className="w-fit text-xs text-accent-glow hover:underline disabled:text-ink-muted disabled:no-underline"
              >
                {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
              </button>
            )}
            <div className="flex justify-end gap-2">
              <DepthButton type="button" variant="secondary" onClick={onClose}>
                Cancel
              </DepthButton>
              <DepthButton
                type="submit"
                variant="danger"
                icon={<Icon name="trash" size={18} />}
                loading={del.isPending}
                disabled={!ready}
              >
                Delete for good
              </DepthButton>
            </div>
          </form>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
