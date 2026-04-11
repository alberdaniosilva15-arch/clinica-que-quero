import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary capturou:', error, errorInfo);
    // Opcional: registrar erro externamente
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#fff', backgroundColor: '#040301', height: '100vh' }}>
          <h1 style={{ color: '#D4AF37' }}>Oops, ocorreu um erro na aplicação</h1>
          <p>Por favor recarregue a página. Se persistir, chame o suporte.</p>
          <details style={{ whiteSpace: 'pre-wrap', marginTop: 16, color: '#FF2525' }}>
            {this.state.error && this.state.error.toString()}
          </details>
          <button 
            onClick={() => window.location.reload()} 
            style={{ 
              marginTop: 16, padding: '10px 20px', backgroundColor: '#D4AF37', 
              color: '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold' 
            }}>
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
