import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { ProfileCard } from '../components/settings/ProfileCard';
import { AboutAppPage, AboutMePage } from './AboutPages';
import { Copyright } from '../components/legal/Copyright';
import * as authApi from '../api/auth';

vi.mock('../api/auth', async (orig) => ({
  ...(await orig<typeof import('../api/auth')>()),
  updateProfile: vi.fn(),
}));

const USER = {
  id: 'p1',
  name: 'Maria Galang',
  email: 'maria@example.com',
  role: 'parent',
  createdAt: '',
  phone: '',
  language: 'auto',
  avatarUrl: null,
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('gd:token', 't');
  localStorage.setItem('gd:user', JSON.stringify(USER));
});

describe('own profile', () => {
  test('name, phone and preferred language are saved; the e-mail stays', async () => {
    vi.mocked(authApi.updateProfile).mockResolvedValue({ ...USER, name: 'Maria G.', phone: '0917', language: 'fil' });
    renderWithProviders(<ProfileCard />);
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled(); // nothing changed yet
    expect(screen.getByDisplayValue('maria@example.com')).toHaveAttribute('readonly');

    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'Maria G.');
    await userEvent.type(screen.getByLabelText('Phone (optional)'), '0917');
    await userEvent.selectOptions(screen.getByLabelText('Preferred language for messages'), 'fil');
    await userEvent.click(save);
    await waitFor(() =>
      expect(vi.mocked(authApi.updateProfile).mock.calls[0]![0]).toEqual({
        name: 'Maria G.',
        phone: '0917',
        language: 'fil',
      }),
    );
    await waitFor(() => expect(JSON.parse(localStorage.getItem('gd:user')!).language).toBe('fil'));
  });

  test('a photo can be added from the camera button', () => {
    renderWithProviders(<ProfileCard />);
    expect(screen.getByRole('button', { name: 'Change profile photo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Profile photo')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  });
});

describe('about pages', () => {
  test('About the developer shows the photo, name, story and stack', () => {
    renderWithProviders(<AboutMePage />);
    expect(screen.getByRole('heading', { name: 'Engr. Emmanuel Christian V. Galang' })).toBeInTheDocument();
    expect(screen.getByTestId('developer-photo')).toHaveAttribute('src', '/about/me.jpg');
    expect(screen.getByText(/Senior Full Stack Developer/)).toBeInTheDocument();
    expect(screen.getByTestId('skills')).toHaveTextContent('Flutter');
    expect(screen.getByText(/raise awareness of fatigue and drowsy driving/)).toBeInTheDocument();
  });

  test('About Guardian Drive explains how it works', () => {
    renderWithProviders(<AboutAppPage />);
    expect(screen.getByText('How it works')).toBeInTheDocument();
    expect(screen.getByText('Instant alerts')).toBeInTheDocument();
    expect(screen.getByText('Any language')).toBeInTheDocument();
  });

  test('clicking the name in the footer opens About the developer', () => {
    renderWithProviders(<Copyright />);
    expect(screen.getByTestId('developer-link')).toHaveAttribute('href', '/about-me');
  });
});
