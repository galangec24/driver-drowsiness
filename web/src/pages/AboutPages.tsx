import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimatedBackground } from '../components/layout/AnimatedBackground';
import { Copyright } from '../components/legal/Copyright';
import { AboutCard } from '../components/settings/AboutCard';
import { DepthButton } from '../components/ui/DepthButton';
import { Icon, type IconName } from '../components/ui/Icon';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { useAuth } from '../store/auth';

/** Shared frame: background, back link, theme toggle, centred column. Public (no sign-in). */
function Page({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  return (
    <div className="relative min-h-screen min-h-dvh">
      <AnimatedBackground />
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link
          to={token ? '/' : '/login'}
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted hover:text-white"
        >
          <Icon name="back" size={18} /> {token ? 'Back to the dashboard' : 'Sign in'}
        </Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-12 sm:px-6">{children}</main>
      <Copyright className="pb-6" />
    </div>
  );
}

const rise = (i = 0) => ({
  initial: { y: 16 },
  animate: { y: 0 },
  transition: { duration: 0.35, delay: i * 0.06, ease: 'easeOut' as const },
});

function Feature({ icon, title, children, i }: { icon: IconName; title: string; children: ReactNode; i: number }) {
  return (
    <motion.div {...rise(i)} className="glass flex flex-col gap-2 p-5">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-primary/20 text-accent-glow">
        <Icon name={icon} size={22} />
      </span>
      <h3 className="font-bold text-white">{title}</h3>
      <p className="text-sm text-ink-muted">{children}</p>
    </motion.div>
  );
}

const STEPS: { title: string; text: string }[] = [
  {
    title: 'Watches, quietly',
    text: 'A small camera in the car looks at the driver’s eyes and head about 30 times a second. Nothing is recorded as video.',
  },
  {
    title: 'Learns what is normal',
    text: 'In the first minutes it learns how this driver normally blinks and looks, so tiny eyes or glasses don’t cause false alarms.',
  },
  {
    title: 'Spots the warning signs',
    text: 'Eyes closing for too long, slow blinks, yawning, nodding off or looking away from the road for too long.',
  },
  {
    title: 'Speaks up and tells you',
    text: 'A calm voice in the car asks the driver to take a break, and the family gets an alert with the place and a photo within seconds.',
  },
];

/** About Guardian Drive: what it does, how, and for whom. */
export function AboutAppPage() {
  return (
    <Page>
      <motion.section {...rise()} className="glass flex flex-col items-center gap-4 p-8 text-center sm:p-12">
        <img
          src="/icons/icon.svg"
          alt=""
          className="h-20 w-20 animate-float drop-shadow-[0_0_18px_rgba(99,102,241,0.55)]"
        />
        <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Know they’re{' '}
          <span className="bg-gradient-to-r from-indigo-400 to-emerald-400 bg-clip-text text-transparent">awake</span>{' '}
          at the wheel.
        </h1>
        <p className="max-w-2xl text-ink-muted">
          Guardian Drive watches for drowsy and distracted driving in real time and tells the driver and their family
          the moment it matters. Driving tired can be as dangerous as driving drunk, and most drivers never notice it
          coming. Guardian Drive does.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link to="/download">
            <DepthButton icon={<Icon name="download" size={18} />}>Get the app</DepthButton>
          </Link>
          <Link to="/about-me">
            <DepthButton variant="secondary">Meet the developer</DepthButton>
          </Link>
        </div>
      </motion.section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold text-white">How it works</h2>
        <ol className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <motion.li key={s.title} {...rise(i)} className="glass flex flex-col gap-2 p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent-primary to-accent-glow text-sm font-bold text-onaccent">
                {i + 1}
              </span>
              <h3 className="font-bold text-white">{s.title}</h3>
              <p className="text-sm text-ink-muted">{s.text}</p>
            </motion.li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold text-white">What you get</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Feature icon="eye" title="Real-time monitoring" i={0}>
            See each driver’s state live: awake, showing fatigue, or drowsy, with easy charts of how open their eyes
            are.
          </Feature>
          <Feature icon="bell" title="Instant alerts" i={1}>
            A notification on your phone or computer within seconds, with a photo, the place and directions. Repeats are
            grouped, so you are never flooded.
          </Feature>
          <Feature icon="pin" title="Live location & history" i={2}>
            Where they are now, every reading by the minute, and how many kilometres they drove today or this week.
          </Feature>
          <Feature icon="phone" title="Talk to the car" i={3}>
            Call the car or send a message. The in-car voice reads it aloud, so the driver never has to look at a phone.
          </Feature>
          <Feature icon="mail" title="Any language" i={4}>
            Write in English, Tagalog, Bisaya, Taglish, Chinese and more. The car reads it in that language and shows it
            on its screen.
          </Feature>
          <Feature icon="lock" title="Private by design" i={5}>
            Only you see your drivers. Faces are matched on our server, deleting a driver needs a code sent to your
            e-mail, and nothing is sold or shared.
          </Feature>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <motion.section {...rise()} className="glass flex flex-col gap-3 p-6">
          <h2 className="text-xl font-bold text-white">Who it is for</h2>
          <ul className="flex flex-col gap-2 text-sm text-ink-muted">
            <li>
              <b className="text-white">Parents</b> of new or young drivers who want peace of mind on long or late
              trips.
            </li>
            <li>
              <b className="text-white">Families</b> with an older driver, or anyone who drives long hours.
            </li>
            <li>
              <b className="text-white">Small fleets</b>: delivery, school service and company drivers.
            </li>
          </ul>
          <p className="glass-inset p-3 text-xs text-ink-muted">
            Guardian Drive helps, but it does not replace rest. If you feel sleepy, stop somewhere safe: a 15–20 minute
            nap and some water are the best cure.
          </p>
        </motion.section>
        <AboutCard />
      </div>
    </Page>
  );
}

const SKILLS = [
  'Python',
  'JavaScript',
  'Flutter',
  'Tailwind CSS',
  'HTML',
  'React',
  'Node.js',
  'MongoDB',
  'Computer vision',
];

/** About the developer (opened by clicking the name in the footer). */
export function AboutMePage() {
  return (
    <Page>
      <motion.section
        {...rise()}
        className="glass flex flex-col items-center gap-6 p-8 text-center md:flex-row md:items-center md:text-left"
      >
        <div className="relative shrink-0">
          <div className="absolute -inset-2 rounded-full bg-gradient-to-br from-accent-primary to-accent-ok opacity-60 blur-xl" />
          <img
            src="/about/me.jpg"
            alt="Engr. Emmanuel Christian V. Galang"
            width={176}
            height={176}
            className="relative h-44 w-44 rounded-full border-4 border-white/20 object-cover shadow-depth-3"
            data-testid="developer-photo"
          />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent-glow">About the developer</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Engr. Emmanuel Christian V. Galang</h1>
          <p className="font-semibold text-white/90">Senior Full Stack Developer · Creator of Guardian Drive</p>
          <p className="text-ink-muted">
            I build complete products, from the camera and the AI in the car to the server, the website and the phone
            app. I like turning hard technology into something simple that keeps people safe.
          </p>
        </div>
      </motion.section>

      <div className="grid gap-6 md:grid-cols-2">
        <motion.section {...rise(1)} className="glass flex flex-col gap-3 p-6">
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <Icon name="heart" size={20} className="text-pink-300" /> Why I built Guardian Drive
          </h2>
          <p className="text-sm text-ink-muted">
            I was inspired to create this project to raise awareness of fatigue and drowsy driving, one of the quietest
            causes of road accidents. Drowsy drivers rarely notice how tired they are until it is almost too late.
          </p>
          <p className="text-sm text-ink-muted">
            Guardian Drive watches for the signs in real time and sends instant notifications to the parents and family,
            so someone who cares can step in before a tired moment turns into an accident.
          </p>
        </motion.section>

        <motion.section {...rise(2)} className="glass flex flex-col gap-3 p-6">
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <Icon name="lab" size={20} className="text-accent-glow" /> Tech stack
          </h2>
          <div className="flex flex-wrap gap-2" data-testid="skills">
            {SKILLS.map((s) => (
              <span
                key={s}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white"
              >
                {s}
              </span>
            ))}
          </div>
          <p className="text-sm text-ink-muted">
            Guardian Drive is built with Python (in-car AI with MediaPipe and OpenCV), Node.js and MongoDB (server),
            React with Tailwind CSS (website) and Flutter (Android, iPhone and Windows apps).
          </p>
        </motion.section>
      </div>

      <motion.section {...rise(3)} className="glass flex flex-col items-center gap-3 p-6 text-center">
        <p className="max-w-xl text-sm text-ink-muted">
          Have an idea, found a problem, or want Guardian Drive for your family or fleet? I would love to hear from you.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link to="/feedback">
            <DepthButton icon={<Icon name="mail" size={18} />}>Send feedback</DepthButton>
          </Link>
          <a href="https://github.com/galangec24" target="_blank" rel="noreferrer">
            <DepthButton variant="secondary">GitHub</DepthButton>
          </a>
          <Link to="/about">
            <DepthButton variant="secondary">About the app</DepthButton>
          </Link>
        </div>
      </motion.section>
    </Page>
  );
}
