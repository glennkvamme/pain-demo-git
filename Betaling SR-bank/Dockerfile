FROM node:22-alpine AS frontend-build
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY BetalingSrBank.csproj ./
RUN dotnet restore BetalingSrBank.csproj
COPY . .
COPY --from=frontend-build /src/public ./public
RUN dotnet publish BetalingSrBank.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
ENV ASPNETCORE_URLS=http://0.0.0.0:10000
ENV PORT=10000
COPY --from=build /app/publish ./
EXPOSE 10000
ENTRYPOINT ["dotnet", "BetalingSrBank.dll"]
