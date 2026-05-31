# Sotar Play — Backend Server

REST API для магазина приложений Sotar Play.

## Запуск локально

```bash
npm install
node server.js
# Сервер запустится на http://localhost:3000
```

## Деплой на Railway

1. Зайди на [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Выбери этот репозиторий
3. Railway сам определит Node.js и запустит `node server.js`
4. Скопируй выданный URL (например `https://sotar-play-server.up.railway.app`)
5. Вставь его в Android приложение как `BASE_URL`

## API Endpoints

### Приложения
| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/apps` | Список всех приложений |
| GET | `/apps?category=Игры` | Фильтр по категории |
| GET | `/apps?search=калькулятор` | Поиск |
| GET | `/apps/:id` | Одно приложение |
| POST | `/apps` | Опубликовать приложение (multipart/form-data) |
| DELETE | `/apps/:id` | Удалить приложение |

### Скачивание
| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/apps/:id/download` | Скачать APK (увеличивает счётчик) |
| GET | `/apk/<filename>` | Прямая ссылка на файл |

### Отзывы
| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/apps/:id/reviews` | Отзывы к приложению |
| POST | `/apps/:id/reviews` | Добавить отзыв |

### Прочее
| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/categories` | Список категорий |
| GET | `/developers/:id` | Профиль разработчика |

## Публикация приложения (POST /apps)

```bash
curl -X POST https://your-server.railway.app/apps \
  -F "title=Мой App" \
  -F "description=Описание" \
  -F "category=Инструменты" \
  -F "version=1.0.0" \
  -F "developer_name=Иван" \
  -F "developer_email=ivan@mail.ru" \
  -F "icon_color=#FF7214" \
  -F "icon_symbol=build" \
  -F "apk=@./myapp.apk"
```

## Структура ответа (приложение)

```json
{
  "id": 1,
  "title": "Мой App",
  "description": "Описание",
  "category": "Инструменты",
  "size_mb": 12.5,
  "version": "1.0.0",
  "developer_id": 1,
  "developer_name": "Иван",
  "icon_color": "#FF7214",
  "icon_symbol": "build",
  "download_count": 0,
  "rating": 5.0,
  "rating_count": 1,
  "apk_filename": "abc123.apk",
  "apk_url": "/apk/abc123.apk",
  "created_at": "2026-05-31T12:00:00"
}
```
