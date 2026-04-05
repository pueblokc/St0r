@echo off
REM Initialize St0r database on Windows
REM Run this after MariaDB/MySQL is installed and running

set MYSQL_USER=root
set MYSQL_PASS=test123
set DB_NAME=urbackup_gui
set APP_USER=urbackup
set APP_PASS=test123

echo Creating database and user...
mysql -u%MYSQL_USER% -p%MYSQL_PASS% -e "CREATE DATABASE IF NOT EXISTS %DB_NAME% CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u%MYSQL_USER% -p%MYSQL_PASS% -e "CREATE USER IF NOT EXISTS '%APP_USER%'@'localhost' IDENTIFIED BY '%APP_PASS%';"
mysql -u%MYSQL_USER% -p%MYSQL_PASS% -e "GRANT ALL PRIVILEGES ON %DB_NAME%.* TO '%APP_USER%'@'localhost';"
mysql -u%MYSQL_USER% -p%MYSQL_PASS% -e "FLUSH PRIVILEGES;"

echo Running schema...
mysql -u%APP_USER% -p%APP_PASS% %DB_NAME% < "%~dp0..\database\init\01_schema.sql"

echo Running migrations...
for %%f in ("%~dp0..\database\migrations\*.sql") do (
    echo   Running %%~nxf...
    mysql -u%APP_USER% -p%APP_PASS% %DB_NAME% < "%%f"
)

echo Database initialized!
echo Connection: mysql -u%APP_USER% -p%APP_PASS% %DB_NAME%
pause
