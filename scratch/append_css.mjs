import fs from 'node:fs';
const css = `
/* Virtual Shop */
.user-shop-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1.5rem;
  margin-bottom: 5rem;
}

.user-shop-card {
  background: white;
  border-radius: 12px;
  padding: 1.2rem;
  box-shadow: 0 4px 6px rgba(0,0,0,0.04);
  border: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  transition: transform 0.2s, box-shadow 0.2s;
}

.user-shop-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 15px rgba(0,0,0,0.08);
}

.user-shop-card .card-cat {
  font-size: 0.75rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  margin-bottom: 0.3rem;
}

.user-shop-card .card-name {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1e293b;
  margin: 0 0 0.5rem 0;
  line-height: 1.3;
  flex: 1;
}

.user-shop-card .card-price {
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--primary);
  margin-bottom: 1rem;
}

.user-shop-card .card-actions {
  display: flex;
  justify-content: center;
}

.btn-add-cart {
  width: 100%;
  background: var(--primary);
  color: white;
  border: none;
  padding: 0.6rem 1rem;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-add-cart:hover {
  opacity: 0.9;
}

.qty-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}

.qty-control button {
  background: none;
  border: none;
  color: #475569;
  padding: 0.6rem 1rem;
  cursor: pointer;
  font-size: 1rem;
  transition: background 0.2s;
}

.qty-control button:hover {
  background: #e2e8f0;
}

.qty-control span {
  font-weight: 700;
  color: #0f172a;
}

.user-shop-cart-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: white;
  padding: 1rem 2rem;
  box-shadow: 0 -4px 20px rgba(0,0,0,0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 1000;
  border-top: 1px solid #e2e8f0;
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.cart-info {
  display: flex;
  flex-direction: column;
}

.cart-count {
  font-size: 0.85rem;
  color: #64748b;
  font-weight: 500;
}

.cart-total {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--primary);
}

.btn-checkout {
  background: var(--success);
  color: white;
  border: none;
  padding: 0.8rem 1.5rem;
  border-radius: 8px;
  font-weight: 700;
  font-size: 1.05rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  transition: opacity 0.2s, transform 0.1s;
}

.btn-checkout:hover {
  opacity: 0.9;
}

.btn-checkout:active {
  transform: scale(0.98);
}

.btn-checkout:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .user-shop-cart-bar {
    padding: 1rem;
    left: 0;
    width: 100%;
  }
}

@media (min-width: 1024px) {
  .user-shop-cart-bar {
    left: 260px;
    width: auto;
  }
}
`;
fs.appendFileSync('src/App.css', css, 'utf8');
