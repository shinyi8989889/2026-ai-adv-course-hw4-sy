const { applyCoupon } = require('../src/utils/coupon');

describe('Coupon module', () => {
  describe('未提供優惠碼', () => {
    it.each([undefined, null, ''])('%s 時折扣為 0', (code) => {
      expect(applyCoupon(code, 1000)).toEqual({ couponCode: null, discount: 0 });
    });
  });

  describe('FLOWER100：滿 800 折 100', () => {
    it('小計 800 元可使用', () => {
      expect(applyCoupon('FLOWER100', 800)).toEqual({ couponCode: 'FLOWER100', discount: 100 });
    });

    it('小計 799 元未達門檻，回傳錯誤', () => {
      const result = applyCoupon('FLOWER100', 799);
      expect(result.error).toBe('COUPON_THRESHOLD_NOT_MET');
      expect(result.couponCode).toBeUndefined();
    });

    it('不分大小寫', () => {
      expect(applyCoupon('flower100', 800)).toEqual({ couponCode: 'FLOWER100', discount: 100 });
    });
  });

  describe('SPRING10：9 折，最多折 300，四捨五入至整數', () => {
    it.each([
      [1000, 100],
      [1234, 123],
      [3500, 300]
    ])('小計 %i 元折 %i 元', (subtotal, expectedDiscount) => {
      expect(applyCoupon('SPRING10', subtotal)).toEqual({ couponCode: 'SPRING10', discount: expectedDiscount });
    });

    it('無門檻，小計 0 元仍可使用', () => {
      expect(applyCoupon('SPRING10', 0)).toEqual({ couponCode: 'SPRING10', discount: 0 });
    });
  });

  describe('SUMMER50：已失效', () => {
    it('任何小計皆回傳錯誤', () => {
      const result = applyCoupon('SUMMER50', 1000);
      expect(result.error).toBe('INVALID_COUPON');
    });
  });

  describe('不存在的優惠碼', () => {
    it('回傳錯誤', () => {
      const result = applyCoupon('NOT-A-COUPON', 1000);
      expect(result.error).toBe('INVALID_COUPON');
    });
  });

  describe('輸入驗證', () => {
    it('非字串的優惠碼回傳錯誤', () => {
      const result = applyCoupon(12345, 1000);
      expect(result.error).toBe('INVALID_COUPON');
    });
  });
});
