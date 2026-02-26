import { requireUser } from '@/src/lib/auth';
import AnalyticsClient from './AnalyticsClient';

export default async function AnalyticsPage() {
  await requireUser();
  return <AnalyticsClient />;
}
