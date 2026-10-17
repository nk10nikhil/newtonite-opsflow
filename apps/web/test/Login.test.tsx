import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Login } from '../src/pages/Login';

describe('Login', () => {
  it('submits the selected seeded account and password', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    render(<Login onLogin={onLogin} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'casey@opsdesk.local' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'opsdesk-demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Seeded demo accounts')).toBeInTheDocument();
    expect(onLogin).toHaveBeenCalledWith('casey@opsdesk.local', 'opsdesk-demo');
  });
});
