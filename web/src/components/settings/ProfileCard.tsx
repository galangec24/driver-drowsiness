import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { updateProfile, type ProfilePatch } from '../../api/auth';
import { errorMessage } from '../../api/client';
import { useAuth } from '../../store/auth';
import { LANGUAGES } from '../../lib/languages';
import { loadImage } from '../../lib/imageQuality';
import { GlassCard } from '../ui/GlassCard';
import { DepthButton } from '../ui/DepthButton';
import { Icon } from '../ui/Icon';
import { UserAvatar } from '../ui/UserAvatar';
import { useToast } from '../ui/Toast';

/** Square, centre-cropped 256 px JPEG: small enough to upload quickly (~20 KB). */
export function squareAvatar(img: HTMLImageElement, size = 256): string {
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.86);
}

const field =
  'h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white outline-none focus:border-accent-glow/70';

/** Settings > Profile: photo, name, phone, preferred language. The e-mail is the sign-in, so it stays. */
export function ProfileCard() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [language, setLanguage] = useState(user?.language ?? 'auto');

  useEffect(() => {
    if (window.location.hash === '#profile') {
      document.getElementById('profile')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const save = useMutation({
    mutationFn: (patch: ProfilePatch) => updateProfile(patch),
    onSuccess: (u) => {
      updateUser(u);
      toast.show({ title: 'Profile saved', tone: 'success' });
    },
    onError: (e) => toast.show({ title: 'Could not save', body: errorMessage(e), tone: 'danger' }),
  });

  const dirty =
    name.trim() !== (user?.name ?? '') ||
    phone.trim() !== (user?.phone ?? '') ||
    language !== (user?.language ?? 'auto');

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.show({ title: 'Choose a photo', body: 'JPEG, PNG or WebP image.', tone: 'warn' });
      return;
    }
    try {
      save.mutate({ avatar: squareAvatar(await loadImage(file)) });
    } catch (e) {
      toast.show({ title: 'Could not read the photo', body: errorMessage(e), tone: 'danger' });
    }
  }

  return (
    <GlassCard interactive={false} data-testid="profile-card">
      <div id="profile" className="scroll-mt-24" />
      <h2 className="mb-4 text-lg font-bold text-white">Profile</h2>
      <div className="mb-5 flex items-center gap-4">
        <div className="relative">
          <UserAvatar name={user?.name} url={user?.avatarUrl} size={84} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Change profile photo"
            className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink-900 bg-accent-primary text-onaccent shadow-depth-2 hover:bg-accent-glow"
          >
            <Icon name="camera" size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm text-ink-muted">
            A clear photo of your face helps your family know who sent a message.
          </p>
          <div className="flex gap-3 text-sm">
            <button
              type="button"
              className="font-semibold text-accent-glow hover:underline"
              onClick={() => fileRef.current?.click()}
            >
              {user?.avatarUrl ? 'Change photo' : 'Add photo'}
            </button>
            {user?.avatarUrl && (
              <button
                type="button"
                className="text-ink-muted hover:text-white hover:underline"
                onClick={() => save.mutate({ avatar: null })}
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          aria-label="Profile photo"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            void pickPhoto(f);
          }}
        />
      </div>

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          save.mutate({ name: name.trim(), phone: phone.trim(), language });
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Name
          <input className={field} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Phone (optional)
          <input
            className={field}
            value={phone}
            maxLength={30}
            inputMode="tel"
            placeholder="+63 917 123 4567"
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          E-mail (used to sign in)
          <input className={`${field} opacity-70`} value={user?.email ?? ''} readOnly />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Preferred language for messages
          <select className={field} value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-ink-muted sm:col-span-2">
          Messages you send start in this language, and the car reads them aloud in it. You can still pick another
          language for each message.
        </p>
        <div className="sm:col-span-2">
          <DepthButton type="submit" loading={save.isPending} disabled={!dirty || !name.trim()}>
            Save changes
          </DepthButton>
        </div>
      </form>
    </GlassCard>
  );
}
