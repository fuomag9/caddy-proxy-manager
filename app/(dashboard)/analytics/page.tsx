import { requireAdmin } from '@/src/lib/auth';
import AnalyticsClient from './AnalyticsClient';

export default async function AnalyticsPage() {
  await requireAdmin();
  return <AnalyticsClient />;
}
