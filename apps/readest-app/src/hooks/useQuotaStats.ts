import { useEffect, useState } from 'react';
import { QuotaType, UserPlan } from '@/types/quota';

export const useQuotaStats = (_briefName = false) => {
  const [quotas, setQuotas] = useState<QuotaType[]>([]);
  const [userProfilePlan, setUserProfilePlan] = useState<UserPlan | undefined>(undefined);

  useEffect(() => {
    // Official login is removed in this fork: no account quotas exist, so
    // report the top plan with no quota rows.
    setUserProfilePlan('pro');
    setQuotas([]);
  }, []);

  return {
    quotas,
    userProfilePlan,
  };
};
