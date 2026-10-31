import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {LandingPage} from '@/features/landing/landing-page';
import ru from '@/messages/ru.json';

describe('registration-first landing stays honest about its next step', () => {
  it('offers registration and a public illustrative sample without enabling the anonymous path', () => {
    const html = renderToStaticMarkup(createElement(LandingPage, {locale: 'ru', messages: ru}));
    expect(html).toContain('href="/ru/register"');
    expect(html).toContain('Зарегистрироваться и начать');
    expect(html).not.toContain('href="/ru/free');
    expect(html).toContain('Пример отчёта');
    expect(html).toContain('id="report-example"');
    expect(html).toContain('не результат реальной диагностики');
    expect(html).toContain('80 вопросов с оценкой 1–5');
    expect(html).toContain('2 можно пропустить');
    expect(html).not.toContain('10–15');
  });

  it('takes an existing user to the workspace with an accurate label', () => {
    const html = renderToStaticMarkup(createElement(LandingPage, {locale: 'ru', messages: ru, authenticated: true}));
    expect(html).toContain('href="/ru/account"');
    expect(html).toContain('Открыть кабинет');
    expect(html).not.toContain('href="/ru/register"');
    expect(html).not.toContain('Зарегистрироваться и начать');
  });
});
