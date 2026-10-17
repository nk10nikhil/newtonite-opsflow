import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConflictBanner } from '../src/components/ConflictBanner';

describe('ConflictBanner', () => {
  it('explains the stale edit and lets the user load the latest version', () => {
    const onLoadLatest = vi.fn();
    render(<ConflictBanner message="The item has a newer version." onLoadLatest={onLoadLatest} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Someone else changed this item.');
    expect(screen.getByText('The item has a newer version.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load latest' }));
    expect(onLoadLatest).toHaveBeenCalledOnce();
  });
});
