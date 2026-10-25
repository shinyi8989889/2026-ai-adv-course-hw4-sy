const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    if (!Auth.requireAuth()) return {};

    const orders = ref([]);
    const loading = ref(true);

    const statusMap = {
      pending: { label: '待付款', cls: 'bg-apricot/20 text-apricot' },
      paid: { label: '已付款', cls: 'bg-sage/20 text-sage' },
      failed: { label: '付款失敗', cls: 'bg-red-100 text-red-600' },
    };

    onMounted(async function () {
      try {
        // Request the max page size so existing members don't lose visibility into
        // older orders now that the API defaults to a 10-item page (Issue C).
        const res = await apiFetch('/api/orders?limit=50');
        orders.value = res.data.orders;
      } catch (e) {
        orders.value = [];
      } finally {
        loading.value = false;
      }
    });

    return { orders, loading, statusMap, formatDate };
  }
}).mount('#app');
