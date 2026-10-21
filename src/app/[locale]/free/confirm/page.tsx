import {notFound} from 'next/navigation';
import {AccessConfirmation} from '@/features/acquisition/forms';
import {acquisitionEnabled} from '@/server/acquisition/contracts';
export default function Page(){if(!acquisitionEnabled())notFound();return <main id="main-content" className="mx-auto min-h-[65vh] max-w-2xl px-5 py-14"><h1 className="text-3xl font-semibold">Ваши результаты диагностики</h1><AccessConfirmation/></main>;}
