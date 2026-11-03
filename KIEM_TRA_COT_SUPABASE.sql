-- Chỉ đọc cấu trúc các bảng; không chỉnh sửa dữ liệu.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('books', 'orders', 'order_items')
ORDER BY table_name, ordinal_position;
