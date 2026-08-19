(function() {
  const Router = {
    routes: {},
    guards: {},
    currentRoute: null,

    init: function(routes) {
      this.routes = routes || {};
      window.addEventListener('hashchange', this.handleHashChange.bind(this));
      this.handleHashChange();
    },

    navigate: function(routeName) {
      window.location.hash = '#/' + routeName;
    },

    current: function() {
      return this.currentRoute;
    },

    addGuard: function(routeName, guardFn) {
      this.guards[routeName] = guardFn;
    },

    getRouteNameFromHash: function() {
      const hash = window.location.hash;
      if (!hash || !hash.startsWith('#/')) {
        return 'connect';
      }
      const routeName = hash.substring(2);
      return this.routes[routeName] ? routeName : 'connect';
    },

    handleHashChange: function() {
      const targetRoute = this.getRouteNameFromHash();

      // Check guards first
      if (this.guards[targetRoute]) {
        const guardResult = this.guards[targetRoute]();
        if (typeof guardResult === 'string') {
          // Redirect
          this.navigate(guardResult);
          return;
        }
        if (guardResult === false) {
          // Guard failed, cancel navigation
          this.revertHash();
          return;
        }
      }

      const previousRoute = this.currentRoute;

      // Call route handler
      if (this.routes[targetRoute]) {
        const handlerResult = this.routes[targetRoute]();
        
        if (handlerResult === false) {
          // Handler cancelled navigation
          this.revertHash();
          return;
        }
      }

      this.currentRoute = targetRoute;

      // Emit custom event
      const event = new CustomEvent('routechange', {
        detail: {
          from: previousRoute,
          to: targetRoute
        }
      });
      document.dispatchEvent(event);
    },

    revertHash: function() {
      if (this.currentRoute) {
        window.location.hash = '#/' + this.currentRoute;
      } else {
        window.location.hash = '';
      }
    }
  };

  window.Router = Router;
})();
