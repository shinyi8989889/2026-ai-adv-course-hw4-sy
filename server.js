const app = require('./app');

const PORT = process.env.PORT || 3001;

if (require.main === module) {
  if (!process.env.JWT_SECRET) {
    console.error('Fatal: JWT_SECRET is not set');
    process.exit(1);
  }
  if (!process.env.ECPAY_MERCHANT_ID || !process.env.ECPAY_HASH_KEY || !process.env.ECPAY_HASH_IV) {
    console.error('Fatal: ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV is not set');
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
