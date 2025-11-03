import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ReviewData {
  id: string;
  employeeName: string;
  encryptedScore: string;
  period: number;
  reviewerId: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface PerformanceStats {
  avgScore: number;
  totalReviews: number;
  highPerformers: number;
  growthTrend: number;
  departmentBreakdown: { [key: string]: number };
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<ReviewData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingReview, setCreatingReview] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newReviewData, setNewReviewData] = useState({ 
    employeeName: "", 
    score: "", 
    period: "", 
    reviewerId: "",
    description: "" 
  });
  const [selectedReview, setSelectedReview] = useState<ReviewData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPeriod, setFilterPeriod] = useState("all");
  const [showFAQ, setShowFAQ] = useState(false);
  const [userHistory, setUserHistory] = useState<any[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const reviewsList: ReviewData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          reviewsList.push({
            id: businessId,
            employeeName: businessData.name,
            encryptedScore: businessId,
            period: Number(businessData.publicValue1) || 0,
            reviewerId: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading review data:', e);
        }
      }
      
      setReviews(reviewsList);
      updateUserHistory(reviewsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateUserHistory = (reviewsList: ReviewData[]) => {
    if (!address) return;
    
    const userActions = reviewsList
      .filter(review => review.creator.toLowerCase() === address.toLowerCase())
      .map(review => ({
        type: 'created',
        target: review.employeeName,
        timestamp: review.timestamp,
        score: review.decryptedValue || 'encrypted'
      }));
    
    setUserHistory(userActions.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10));
  };

  const createReview = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingReview(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating review with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const scoreValue = parseInt(newReviewData.score) || 0;
      const businessId = `review-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, scoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newReviewData.employeeName,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newReviewData.period) || 202401,
        parseInt(newReviewData.reviewerId) || 1,
        newReviewData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Review created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewReviewData({ employeeName: "", score: "", period: "", reviewerId: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingReview(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const calculateStats = (): PerformanceStats => {
    const filteredReviews = reviews.filter(review => {
      const matchesSearch = review.employeeName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesPeriod = filterPeriod === "all" || review.period.toString() === filterPeriod;
      return matchesSearch && matchesPeriod;
    });

    const verifiedScores = filteredReviews
      .filter(review => review.isVerified && review.decryptedValue)
      .map(review => review.decryptedValue!)
      .filter(score => score > 0);

    const avgScore = verifiedScores.length > 0 
      ? verifiedScores.reduce((sum, score) => sum + score, 0) / verifiedScores.length 
      : 0;

    const highPerformers = verifiedScores.filter(score => score >= 8).length;
    
    const departmentBreakdown: { [key: string]: number } = {};
    filteredReviews.forEach(review => {
      const dept = review.description.split('-')[0] || 'General';
      departmentBreakdown[dept] = (departmentBreakdown[dept] || 0) + 1;
    });

    return {
      avgScore: Math.round(avgScore * 10) / 10,
      totalReviews: filteredReviews.length,
      highPerformers,
      growthTrend: filteredReviews.length > 5 ? 12 : 0,
      departmentBreakdown
    };
  };

  const renderPerformanceChart = (stats: PerformanceStats) => {
    return (
      <div className="performance-chart">
        <div className="chart-metric">
          <div className="metric-value">{stats.avgScore}</div>
          <div className="metric-label">Average Score</div>
        </div>
        <div className="chart-bars">
          <div className="bar-container">
            <div className="bar-label">Total Reviews</div>
            <div className="bar">
              <div 
                className="bar-fill" 
                style={{ width: `${Math.min(100, stats.totalReviews * 10)}%` }}
              >
                <span className="bar-value">{stats.totalReviews}</span>
              </div>
            </div>
          </div>
          <div className="bar-container">
            <div className="bar-label">High Performers</div>
            <div className="bar">
              <div 
                className="bar-fill high" 
                style={{ width: `${Math.min(100, stats.highPerformers * 20)}%` }}
              >
                <span className="bar-value">{stats.highPerformers}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">🔒</div>
          <div className="step-content">
            <h4>Score Encryption</h4>
            <p>Performance scores encrypted with FHE</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">📊</div>
          <div className="step-content">
            <h4>Secure Storage</h4>
            <p>Encrypted data stored on blockchain</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🔓</div>
          <div className="step-content">
            <h4>Privacy-Preserving Analysis</h4>
            <p>Compute statistics without exposing individual scores</p>
          </div>
        </div>
      </div>
    );
  };

  const filteredReviews = reviews.filter(review => {
    const matchesSearch = review.employeeName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPeriod = filterPeriod === "all" || review.period.toString() === filterPeriod;
    return matchesSearch && matchesPeriod;
  });

  const stats = calculateStats();

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>ReviewGuard FHE 🔐</h1>
            <p>Private Employee Performance Review</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Start</h2>
            <p>Secure, privacy-preserving performance reviews powered by FHE</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>ReviewGuard FHE</h1>
          <p>Privacy-Preserving Performance Reviews</p>
        </div>
        
        <div className="header-actions">
          <button className="nav-btn" onClick={() => setShowFAQ(true)}>FAQ</button>
          <button className="test-btn" onClick={callIsAvailable}>Test Contract</button>
          <ConnectButton />
        </div>
      </header>

      <main className="main-content">
        <section className="stats-section">
          <div className="stats-header">
            <h2>Performance Analytics</h2>
            <div className="fhe-badge">FHE 🔐 Encrypted</div>
          </div>
          {renderPerformanceChart(stats)}
          {renderFHEFlow()}
        </section>

        <section className="reviews-section">
          <div className="section-header">
            <h2>Performance Reviews</h2>
            <div className="controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search employees..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <select value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)}>
                <option value="all">All Periods</option>
                <option value="202401">2024 Q1</option>
                <option value="202402">2024 Q2</option>
                <option value="202403">2024 Q3</option>
                <option value="202404">2024 Q4</option>
              </select>
              <button onClick={loadData} disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
              <button onClick={() => setShowCreateModal(true)} className="primary-btn">
                + New Review
              </button>
            </div>
          </div>

          <div className="reviews-grid">
            {filteredReviews.map((review, index) => (
              <div key={index} className="review-card" onClick={() => setSelectedReview(review)}>
                <div className="card-header">
                  <h3>{review.employeeName}</h3>
                  <span className={`status ${review.isVerified ? 'verified' : 'encrypted'}`}>
                    {review.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                  </span>
                </div>
                <div className="card-details">
                  <p>Period: {review.period}</p>
                  <p>Department: {review.description}</p>
                  <p>Reviewer: #{review.reviewerId}</p>
                </div>
                {review.isVerified && review.decryptedValue && (
                  <div className="score-display">
                    Final Score: <strong>{review.decryptedValue}/10</strong>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {userHistory.length > 0 && (
          <section className="history-section">
            <h3>Your Recent Activity</h3>
            <div className="history-list">
              {userHistory.map((action, index) => (
                <div key={index} className="history-item">
                  <span className="action-type">Reviewed</span>
                  <span className="action-target">{action.target}</span>
                  <span className="action-time">
                    {new Date(action.timestamp * 1000).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {showCreateModal && (
        <CreateReviewModal
          onSubmit={createReview}
          onClose={() => setShowCreateModal(false)}
          creating={creatingReview}
          reviewData={newReviewData}
          setReviewData={setNewReviewData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedReview && (
        <ReviewDetailModal
          review={selectedReview}
          onClose={() => setSelectedReview(null)}
          isDecrypting={isDecrypting}
          decryptData={() => decryptData(selectedReview.id)}
        />
      )}

      {showFAQ && (
        <FAQModal onClose={() => setShowFAQ(false)} />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          {transactionStatus.message}
        </div>
      )}
    </div>
  );
};

const CreateReviewModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  reviewData: any;
  setReviewData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, reviewData, setReviewData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'score' || name === 'reviewerId') {
      const intValue = value.replace(/[^\d]/g, '');
      setReviewData({ ...reviewData, [name]: intValue });
    } else {
      setReviewData({ ...reviewData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>New Performance Review</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Performance scores are encrypted to ensure privacy</p>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>Employee Name *</label>
              <input
                type="text"
                name="employeeName"
                value={reviewData.employeeName}
                onChange={handleChange}
                placeholder="Enter employee name"
              />
            </div>

            <div className="form-group">
              <label>Performance Score (1-10) *</label>
              <input
                type="number"
                name="score"
                min="1"
                max="10"
                value={reviewData.score}
                onChange={handleChange}
                placeholder="1-10"
              />
              <span className="input-hint">FHE Encrypted</span>
            </div>

            <div className="form-group">
              <label>Review Period *</label>
              <input
                type="number"
                name="period"
                value={reviewData.period}
                onChange={handleChange}
                placeholder="202401"
              />
              <span className="input-hint">e.g., 202401 for Q1 2024</span>
            </div>

            <div className="form-group">
              <label>Reviewer ID *</label>
              <input
                type="number"
                name="reviewerId"
                value={reviewData.reviewerId}
                onChange={handleChange}
                placeholder="Reviewer identifier"
              />
            </div>

            <div className="form-group full-width">
              <label>Department/Description</label>
              <textarea
                name="description"
                value={reviewData.description}
                onChange={handleChange}
                placeholder="Department and review notes"
                rows={3}
              />
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="secondary-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !reviewData.employeeName || !reviewData.score}
            className="primary-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Review"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ReviewDetailModal: React.FC<{
  review: ReviewData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ review, onClose, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Review Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item">
              <label>Employee</label>
              <span>{review.employeeName}</span>
            </div>
            <div className="detail-item">
              <label>Review Period</label>
              <span>{review.period}</span>
            </div>
            <div className="detail-item">
              <label>Reviewer</label>
              <span>#{review.reviewerId}</span>
            </div>
            <div className="detail-item">
              <label>Department</label>
              <span>{review.description}</span>
            </div>
            <div className="detail-item">
              <label>Created</label>
              <span>{new Date(review.timestamp * 1000).toLocaleDateString()}</span>
            </div>
          </div>

          <div className="score-section">
            <h3>Performance Score</h3>
            <div className="score-display-large">
              {review.isVerified && review.decryptedValue ? (
                <div className="verified-score">
                  <span className="score-value">{review.decryptedValue}</span>
                  <span className="score-max">/10</span>
                  <div className="verification-badge">✅ On-chain Verified</div>
                </div>
              ) : (
                <div className="encrypted-score">
                  <div className="encrypted-icon">🔒</div>
                  <span>FHE Encrypted</span>
                  <button 
                    onClick={handleDecrypt} 
                    disabled={isDecrypting}
                    className="decrypt-btn"
                  >
                    {isDecrypting ? "Decrypting..." : "Reveal Score"}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="fhe-explanation">
            <h4>🔐 How FHE Protects Privacy</h4>
            <p>Individual scores remain encrypted while allowing secure computation of aggregate statistics. This prevents workplace retaliation while maintaining data utility.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

const FAQModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const faqs = [
    {
      question: "How does FHE protect employee privacy?",
      answer: "Fully Homomorphic Encryption allows computation on encrypted data without decryption. Individual scores remain private while enabling aggregate analysis."
    },
    {
      question: "Who can see the performance scores?",
      answer: "Scores are encrypted on-chain. Only authorized parties with decryption keys can view individual scores after proper verification."
    },
    {
      question: "How is data verification handled?",
      answer: "The FHE system uses cryptographic proofs to verify decryption results on-chain without exposing the decryption process."
    }
  ];

  return (
    <div className="modal-overlay">
      <div className="modal-content faq-modal">
        <div className="modal-header">
          <h2>FHE Performance Review FAQ</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          {faqs.map((faq, index) => (
            <div key={index} className="faq-item">
              <h3>{faq.question}</h3>
              <p>{faq.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default App;

