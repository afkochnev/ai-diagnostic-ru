import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const fetchMock = vi.fn();
const href = '/ru/free?utm_source=blog.iteam.ru';
function click(patch: Record<string, unknown> = {}) {
  return {defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0, preventDefault: vi.fn(), ...patch};
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('document', {referrer: 'https://blog.iteam.ru/audit'});
  vi.stubGlobal('location', {origin: 'https://audit.iteam.ru'});
});
afterEach(() => {vi.unstubAllGlobals();});

describe('landing CTA keeps navigation independent of analytics', () => {
  it('returns immediately without preventing navigation while the visit is pending, then records the CTA in order', async () => {
    let finishVisit!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>(resolve => {finishVisit = resolve;}));
    fetchMock.mockResolvedValueOnce(new Response('{}'));
    const {AcquisitionCTA} = await import('@/features/acquisition/tracking');
    const link = AcquisitionCTA({href, children: 'Начать'});
    const event = click();

    expect(link.props.href).toBe(href);
    expect(link.props.onClick(event)).toBeUndefined();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/acquisition/visit');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({utm_source: 'blog.iteam.ru', referrer_host: 'blog.iteam.ru'});

    finishVisit(new Response('{}'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/acquisition/cta');
    expect(fetchMock.mock.calls.every(([, options]) => options.keepalive === true)).toBe(true);
  });

  it.each([{metaKey: true}, {ctrlKey: true}, {shiftKey: true}, {altKey: true}, {button: 1}, {defaultPrevented: true}])('preserves native link behavior for %o', async patch => {
    const {AcquisitionCTA} = await import('@/features/acquisition/tracking');
    const link = AcquisitionCTA({href, children: 'Начать'});
    const event = click(patch);
    expect(link.props.onClick(event)).toBeUndefined();
    expect(link.props.href).toBe(href);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
