// Coupon rules are fixed in code for this issue; no admin management yet.
const COUPONS = Object.freeze({
  FLOWER100: Object.freeze({ type: 'fixed', amount: 100, minSubtotal: 800, active: true }),
  SPRING10: Object.freeze({ type: 'percent', rate: 0.1, maxDiscount: 300, minSubtotal: 0, active: true }),
  SUMMER50: Object.freeze({ type: 'fixed', amount: 50, minSubtotal: 0, active: false })
});

function calculateDiscount(coupon, subtotal) {
  if (coupon.type === 'fixed') {
    return coupon.amount;
  }
  return Math.min(Math.round(subtotal * coupon.rate), coupon.maxDiscount);
}

/**
 * Resolve an optional coupon code against the order subtotal.
 * Returns { couponCode, discount } when there is nothing to reject (couponCode is
 * null and discount is 0 when no code was given), or { error, message } otherwise.
 */
function applyCoupon(code, subtotal) {
  if (code === undefined || code === null || code === '') {
    return { couponCode: null, discount: 0 };
  }

  if (typeof code !== 'string') {
    return { error: 'INVALID_COUPON', message: '優惠碼格式不正確' };
  }

  const normalized = code.trim().toUpperCase();
  const coupon = COUPONS[normalized];

  if (!coupon || !coupon.active) {
    return { error: 'INVALID_COUPON', message: '優惠碼無效或已失效' };
  }

  if (subtotal < coupon.minSubtotal) {
    return {
      error: 'COUPON_THRESHOLD_NOT_MET',
      message: `商品小計需滿 ${coupon.minSubtotal} 元才能使用優惠碼 ${normalized}`
    };
  }

  return { couponCode: normalized, discount: calculateDiscount(coupon, subtotal) };
}

module.exports = {
  COUPONS,
  applyCoupon
};
