import { useState, useCallback, useMemo } from 'react';
import { PRODUCTS, OPTIONAL_BUMPS } from '../lib/constants';
import { createOrder } from '../lib/api';
import { initiatePayment } from '../lib/cashfree';

const STAGES = {
  FORM: 'form',
  PROCESSING: 'processing',
  ERROR: 'error',
};

const INITIAL_FORM = { name: '', email: '', phone: '', businessType: '' };

/**
 * Manages all checkout state: form data, bump selections, order submission.
 * @param {object} utmParams - UTM parameters from useUTM()
 */
export function useCheckout(utmParams) {
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [selectedBumps, setSelectedBumps] = useState(new Set());
  const [stage, setStage] = useState(STAGES.FORM);
  const [errorMessage, setErrorMessage] = useState('');

  // Computed totals
  const { orderTotal, savings } = useMemo(() => {
    let total = PRODUCTS.BASE.price;
    let saved = PRODUCTS.BASE.originalPrice - PRODUCTS.BASE.price;
    for (const bump of OPTIONAL_BUMPS) {
      if (selectedBumps.has(bump.id)) {
        total += bump.price;
        saved += bump.originalPrice - bump.price;
      }
    }
    return { orderTotal: total, savings: saved };
  }, [selectedBumps]);

  const handleFieldChange = useCallback((field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const toggleBump = useCallback((bumpId) => {
    setSelectedBumps((prev) => {
      const next = new Set(prev);
      if (next.has(bumpId)) {
        next.delete(bumpId);
      } else {
        next.add(bumpId);
      }
      return next;
    });
  }, []);

  const validate = () => {
    const errors = [];
    if (!formData.name.trim() || formData.name.trim().length < 2)
      errors.push('Please enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email))
      errors.push('Please enter a valid email address.');
    if (!/^[6-9]\d{9}$/.test(formData.phone.replace(/\s/g, '')))
      errors.push('Please enter a valid 10-digit mobile number.');
    if (!formData.businessType)
      errors.push('Please select your business type.');
    return errors;
  };

  const handleSubmit = useCallback(
    async (e) => {
      if (e) e.preventDefault();
      setErrorMessage('');

      const errors = validate();
      if (errors.length > 0) {
        setErrorMessage(errors[0]);
        return;
      }

      setStage(STAGES.PROCESSING);

      try {
        const result = await createOrder({
          customer: {
            name: formData.name.trim(),
            email: formData.email.toLowerCase().trim(),
            phone: formData.phone.replace(/\s/g, ''),
            businessType: formData.businessType,
          },
          items: Array.from(selectedBumps),
          utmParams: utmParams || {},
        });

        await initiatePayment(result.payment_session_id);
        // Cashfree will redirect the browser — execution stops here on success
      } catch (err) {
        setStage(STAGES.ERROR);
        setErrorMessage(err.message || 'Something went wrong. Please try again.');
      }
    },
    [formData, selectedBumps, utmParams],
  );

  return {
    formData,
    handleFieldChange,
    selectedBumps,
    toggleBump,
    orderTotal,
    savings,
    stage,
    isProcessing: stage === STAGES.PROCESSING,
    errorMessage,
    handleSubmit,
    resetError: () => { setStage(STAGES.FORM); setErrorMessage(''); },
  };
}
